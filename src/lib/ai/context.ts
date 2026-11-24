import "server-only";
import { db } from "@/lib/supabase/admin";
import { stripQuoted } from "@/lib/mail/parse";
import { businessDaysBetween, formatDateEs, toBogotaDate, todayBogota } from "@/lib/business-days";
import type { Settings } from "@/lib/settings";
import type { Message, Ticket } from "@/lib/types";

const attr = (s: string) => s.replace(/"/g, "'");

export type ThreadContext = { ticket: Ticket; messages: Message[]; files: Map<number, string[]> };

export async function loadThread(ticketId: number): Promise<ThreadContext | null> {
  const [{ data: ticket }, { data: messages }] = await Promise.all([
    db().from("tickets").select("*").eq("id", ticketId).maybeSingle(),
    db().from("messages").select("*").eq("ticket_id", ticketId).order("sent_at", { ascending: true }),
  ]);
  if (!ticket) return null;
  const msgs = (messages ?? []) as Message[];
  const files = new Map<number, string[]>();
  if (msgs.length) {
    const { data: atts } = await db()
      .from("attachments")
      .select("message_id, filename")
      .in("message_id", msgs.map((m) => m.id));
    for (const a of atts ?? []) files.set(a.message_id, [...(files.get(a.message_id) ?? []), a.filename]);
  }
  return { ticket: ticket as Ticket, messages: msgs, files };
}

/** Hilo como texto etiquetado <correo>, con adjuntos. */
export function transcript(ctx: ThreadContext, opts: { last?: number; maxChars?: number } = {}): string {
  const { last = 15, maxChars = 4000 } = opts;
  return ctx.messages
    .slice(-last)
    .map((m) => {
      const who = m.direction === "in" ? `cliente ${m.from_email}` : `nosotros (${m.from_email})`;
      const files = ctx.files.get(m.id) ?? [];
      return `<correo de="${attr(who)}" fecha="${m.sent_at}" asunto="${attr(m.subject)}"${m.is_auto ? ' automatico="si"' : ""}${
        files.length ? ` adjuntos="${attr(files.join(", "))}"` : ""
      }>
${stripQuoted(m.text_body).slice(0, maxChars)}
</correo>`;
    })
    .join("\n\n");
}

export function ticketFacts(t: Ticket, settings: Settings): string {
  const elapsed = businessDaysBetween(toBogotaDate(new Date(t.requested_at)), todayBogota());
  return `DATOS DEL TICKET (fuente confiable)
- Ticket: #${t.id}
- Solicitante: ${t.requester_name ?? "(sin nombre)"} <${t.requester_email}>
- Fecha de solicitud: ${formatDateEs(new Date(t.requested_at))}
- Días hábiles transcurridos: ${elapsed} de ${settings.sla_business_days}
- Fecha límite (días hábiles): ${formatDateEs(t.due_date)}
- Estado: ${t.status}${t.delivered_at ? ` (entregado el ${formatDateEs(new Date(t.delivered_at))})` : ""}
- Correo de espera enviado: ${t.wait_sent_at ? formatDateEs(new Date(t.wait_sent_at)) : "no"}
- Sentimiento detectado: ${t.sentiment}
- Hoy: ${todayBogota()}`;
}
