"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAgent } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { syncAll } from "@/lib/mail/sync";
import { classifyPending, generateSuggestions, triageTicket } from "@/lib/ai";
import { sendReply, type OutgoingAttachment } from "@/lib/mail/send";
import { sendWaitEmail } from "@/lib/sla";
import { updateTicket } from "@/lib/tickets";
import { setSetting } from "@/lib/settings";
import { withJobLock } from "@/lib/lock";
import { env } from "@/lib/env";
import type { Ticket, TicketStatus } from "@/lib/types";

const MAX_UPLOAD = 4 * 1024 * 1024; // límite práctico de Vercel (4.5 MB por request)

async function loadTicket(id: number): Promise<Ticket> {
  const { data } = await db().from("tickets").select("*").eq("id", id).single();
  if (!data) throw new Error("Ticket no encontrado");
  return data as Ticket;
}

export async function syncNow() {
  await requireAgent();
  const started = Date.now();
  const res = await withJobLock("sync", 120, async () => {
    const mail = await syncAll({ budgetMs: 25_000 });
    if (env.aiEnabled()) await classifyPending(started + 50_000, 5);
    return mail;
  });
  revalidatePath("/");
  return res ? { ok: true as const, report: res } : { ok: false as const, error: "Ya hay una sincronización en curso" };
}

export type SendState = { ok?: boolean; error?: string } | undefined;

export async function sendReplyAction(_prev: SendState, formData: FormData): Promise<SendState> {
  const agent = await requireAgent();
  try {
    const ticketId = Number(formData.get("ticket_id"));
    const subject = String(formData.get("subject") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const cc = String(formData.get("cc") ?? "")
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    const markDelivered = formData.get("mark_delivered") === "on";
    const suggestionId = Number(formData.get("suggestion_id") || 0);
    const optionIndex = Number(formData.get("option_index") ?? -1);
    if (!subject || !body) return { error: "Asunto y mensaje son obligatorios" };

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_UPLOAD) return { error: "Los adjuntos superan 4 MB. Comprímalos o envíelos desde webmail." };
    const attachments: OutgoingAttachment[] = await Promise.all(
      files.map(async (f) => ({
        filename: f.name,
        contentType: f.type || "application/octet-stream",
        content: Buffer.from(await f.arrayBuffer()),
      })),
    );

    const ticket = await loadTicket(ticketId);
    await sendReply({ ticket, subject, body, cc, attachments, sentBy: agent.email });

    if (markDelivered) {
      await updateTicket(
        ticketId,
        { status: "entregado", delivered_at: new Date().toISOString(), needs_attention: false },
        agent.email,
        "delivered",
      );
    }
    if (suggestionId && optionIndex >= 0) {
      await db().from("reply_suggestions").update({ used_index: optionIndex }).eq("id", suggestionId);
    }
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { error: e instanceof Error ? e.message : "Error enviando el correo" };
  }
}

export async function setStatusAction(ticketId: number, status: TicketStatus) {
  const agent = await requireAgent();
  const now = new Date().toISOString();
  const patch: Partial<Ticket> = { status, needs_attention: false };
  if (status === "entregado") patch.delivered_at = now;
  if (status === "cerrado") patch.closed_at = now;
  if (status === "abierto" || status === "en_proceso") {
    patch.closed_at = null;
    patch.delivered_at = null;
    patch.needs_attention = true;
  }
  await updateTicket(ticketId, patch, agent.email, `status:${status}`);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/");
}

export async function markAttendedAction(ticketId: number) {
  const agent = await requireAgent();
  await updateTicket(ticketId, { needs_attention: false }, agent.email, "attended");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/");
}

export async function sendWaitNowAction(ticketId: number) {
  const agent = await requireAgent();
  const ticket = await loadTicket(ticketId);
  if (ticket.wait_sent_at) return { error: "El correo de espera ya fue enviado" };
  await sendWaitEmail(ticket, agent.email);
  revalidatePath(`/tickets/${ticketId}`);
  return { ok: true };
}

export async function generateSuggestionsAction(ticketId: number, instructions?: string) {
  await requireAgent();
  if (!env.aiEnabled()) return { error: "Sin IA en la app (AI_PROVIDER=none). Pídeselo a Claude Code vía MCP." };
  try {
    const s = await generateSuggestions(ticketId, instructions?.trim() || undefined);
    revalidatePath(`/tickets/${ticketId}`);
    return s ? { ok: true } : { error: "La IA no pudo generar opciones para este caso" };
  } catch (e) {
    console.error(e);
    return { error: e instanceof Error ? e.message : "Error generando opciones" };
  }
}

export async function triageAction(ticketId: number) {
  await requireAgent();
  if (!env.aiEnabled()) return { error: "Sin IA en la app (AI_PROVIDER=none). Pídeselo a Claude Code vía MCP." };
  try {
    await triageTicket(ticketId);
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error en la revisión" };
  }
}

// ---------- Ajustes ----------

export async function saveSettingsAction(formData: FormData) {
  await requireAdmin();
  await setSetting("response_guidelines", String(formData.get("response_guidelines") ?? ""));
  await setSetting("signature", String(formData.get("signature") ?? ""));
  const days = Math.max(1, Math.min(60, Number(formData.get("sla_business_days") || 10)));
  await setSetting("sla_business_days", days);
  await setSetting("sla_auto_send", formData.get("sla_auto_send") === "on");
  await setSetting("sla_skip_angry", formData.get("sla_skip_angry") === "on");
  const start = String(formData.get("sla_start_date") ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) await setSetting("sla_start_date", start);
  revalidatePath("/ajustes");
}

export async function saveTemplateAction(formData: FormData) {
  await requireAdmin();
  const key = String(formData.get("key") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!key) return;
  await db().from("templates").upsert(
    {
      key,
      name: String(formData.get("name") ?? key),
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    },
    { onConflict: "key" },
  );
  revalidatePath("/ajustes");
}

export async function deleteTemplateAction(formData: FormData) {
  await requireAdmin();
  const key = String(formData.get("key"));
  if (key === "espera") return; // la usa el SLA
  await db().from("templates").delete().eq("key", key);
  revalidatePath("/ajustes");
}

export async function addUserAction(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return;
  await db().from("allowed_users").upsert({
    email,
    name: String(formData.get("name") ?? "") || null,
    role: formData.get("role") === "admin" ? "admin" : "agent",
  });
  revalidatePath("/ajustes");
}

export async function removeUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const email = String(formData.get("email"));
  if (email === admin.email) return;
  await db().from("allowed_users").delete().eq("email", email);
  revalidatePath("/ajustes");
}
