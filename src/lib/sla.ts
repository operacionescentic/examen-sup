import "server-only";
import { db } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { getTemplate, render, replySubject, templateVars } from "@/lib/templates";
import { sendReply } from "@/lib/mail/send";
import { todayBogota } from "@/lib/business-days";
import type { Ticket } from "@/lib/types";

export type SlaReport = { candidates: number; sent: number; flagged: number; errors: string[]; dryRun: boolean };

/** Envía el correo de espera a un ticket. Marca primero (idempotente) y revierte si falla. */
export async function sendWaitEmail(ticket: Ticket, actor: string) {
  const [tpl, settings] = await Promise.all([getTemplate("espera"), getSettings()]);
  if (!tpl) throw new Error("Falta la plantilla 'espera'");

  // Reserva atómica: solo un proceso puede pasar wait_sent_at de null a now()
  const { data: claimed } = await db()
    .from("tickets")
    .update({ wait_sent_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .is("wait_sent_at", null)
    .select("id");
  if (!claimed?.length) return false;

  try {
    const vars = templateVars(ticket, settings);
    await sendReply({
      ticket,
      subject: render(tpl.subject, vars) || replySubject(ticket.subject),
      body: render(tpl.body, vars),
      sentBy: actor,
    });
    return true;
  } catch (e) {
    await db().from("tickets").update({ wait_sent_at: null }).eq("id", ticket.id);
    throw e;
  }
}

/** Cron diario: tickets que cumplieron N días hábiles sin entrega → correo de espera. */
export async function runSla(): Promise<SlaReport> {
  const settings = await getSettings();
  const today = todayBogota();
  const report: SlaReport = { candidates: 0, sent: 0, flagged: 0, errors: [], dryRun: !settings.sla_auto_send };

  const { data } = await db()
    .from("tickets")
    .select("*")
    .is("wait_sent_at", null)
    .is("delivered_at", null)
    .in("status", ["abierto", "en_proceso"])
    .lte("due_date", today)
    .gte("due_date", settings.sla_start_date) // nunca al histórico
    .or("imported.eq.false,triaged_at.not.is.null") // importados solo si la IA ya confirmó su estado
    .order("due_date", { ascending: true })
    .limit(100);

  const tickets = (data ?? []) as Ticket[];
  report.candidates = tickets.length;

  for (const t of tickets) {
    const angry = t.sentiment !== "neutral";
    if (!settings.sla_auto_send || (settings.sla_skip_angry && angry)) {
      // No se envía solo: queda marcado para que un agente decida
      if (!t.needs_attention) {
        await db().from("tickets").update({ needs_attention: true }).eq("id", t.id);
      }
      await db().from("audit_log").insert({
        ticket_id: t.id,
        actor: "sistema:sla",
        action: "sla_flagged",
        details: { reason: angry ? "cliente_molesto" : "auto_envio_desactivado", due_date: t.due_date },
      });
      report.flagged++;
      continue;
    }
    try {
      if (await sendWaitEmail(t, "sistema:sla")) report.sent++;
    } catch (e) {
      report.errors.push(`#${t.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
