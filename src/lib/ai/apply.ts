import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Ticket } from "@/lib/types";
import type { Classification, Suggestion, Triage } from "./schemas";

/** Guarda la clasificación de un correo entrante (venga de la app o de Claude Code por MCP). */
export async function applyClassification(ticketId: number, c: Classification, messageIds: number[] = []) {
  const { data: t } = await db().from("tickets").select("requester_name").eq("id", ticketId).single();
  await db()
    .from("tickets")
    .update({
      sentiment: c.sentiment,
      urgency: c.urgency,
      intent: c.intent,
      ai_summary: c.summary,
      requester_name: t?.requester_name ?? c.requester_name,
    })
    .eq("id", ticketId);
  const now = new Date().toISOString();
  if (messageIds.length) {
    await db().from("messages").update({ classified_at: now }).in("id", messageIds);
  } else {
    await db().from("messages").update({ classified_at: now }).eq("ticket_id", ticketId).is("classified_at", null);
  }
}

/** Guarda opciones de respuesta. NO envía nada. */
export async function saveSuggestions(ticketId: number, s: Suggestion, source: "ai" | "mcp") {
  const { data, error } = await db()
    .from("reply_suggestions")
    .insert({
      ticket_id: ticketId,
      source,
      analysis: s.analysis,
      options: s.options,
      recommended_index: Math.min(s.recommended_index, s.options.length - 1),
      escalate: s.escalate,
    })
    .select("*")
    .single();
  if (error) throw error;
  await db().from("tickets").update({ needs_attention: true }).eq("id", ticketId);
  return data;
}

const validDate = (s: string | null) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);

/** Aplica el resultado del triage: estado, entrega, correo de espera ya enviado, etc. */
export async function applyTriage(ticketId: number, r: Triage, actor: string) {
  const [{ data: ticket }, { data: last }] = await Promise.all([
    db().from("tickets").select("*").eq("id", ticketId).single(),
    db().from("messages").select("sent_at").eq("ticket_id", ticketId).order("sent_at", { ascending: false }).limit(1),
  ]);
  if (!ticket) throw new Error(`Ticket #${ticketId} no existe`);
  const t = ticket as Ticket;
  const lastMsgAt = (last?.[0]?.sent_at as string | undefined) ?? new Date().toISOString();

  const status =
    r.state === "entregado" && !r.needs_reply
      ? "entregado"
      : r.state === "sin_accion"
        ? "cerrado"
        : r.state === "pendiente_respuesta" || r.needs_reply
          ? "abierto"
          : "en_proceso";
  const deliveredAt = r.delivered ? (validDate(r.delivered_at) ?? lastMsgAt) : null;

  const { error } = await db()
    .from("tickets")
    .update({
      status,
      delivered_at: deliveredAt,
      wait_sent_at: r.wait_email_sent ? (validDate(r.wait_email_at) ?? lastMsgAt) : t.wait_sent_at,
      closed_at: status === "cerrado" ? lastMsgAt : null,
      needs_attention: r.needs_reply,
      sentiment: r.sentiment,
      intent: r.intent,
      ai_summary: r.summary,
      requester_name: t.requester_name ?? r.requester_name,
      triaged_at: new Date().toISOString(),
      triage: {
        state: r.state,
        delivered: r.delivered,
        delivered_at: deliveredAt,
        delivery_evidence: r.delivery_evidence,
        wait_email_sent: r.wait_email_sent,
        wait_email_at: r.wait_email_at,
        needs_reply: r.needs_reply,
        reason: r.reason,
        by: actor,
      },
    })
    .eq("id", ticketId);
  if (error) throw error;
  // Mensajes ya cubiertos por el triage no necesitan clasificación individual
  await db().from("messages").update({ classified_at: new Date().toISOString() }).eq("ticket_id", ticketId).is("classified_at", null);
  await db().from("audit_log").insert({ ticket_id: ticketId, actor, action: "triage", details: r });
  return status;
}
