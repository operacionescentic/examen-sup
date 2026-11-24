import "server-only";
import { db } from "@/lib/supabase/admin";
import { businessDaysBetween, formatDateEs, toBogotaDate, todayBogota } from "@/lib/business-days";
import type { Template, Ticket } from "@/lib/types";
import type { Settings } from "@/lib/settings";

export async function getTemplate(key: string): Promise<Template | null> {
  const { data } = await db().from("templates").select("*").eq("key", key).maybeSingle();
  return (data as Template) ?? null;
}

export async function listTemplates(): Promise<Template[]> {
  const { data } = await db().from("templates").select("*").order("name");
  return (data as Template[]) ?? [];
}

export function templateVars(ticket: Ticket, settings: Settings): Record<string, string> {
  const name = ticket.requester_name?.split(/\s+/)[0] || "";
  return {
    nombre: ticket.requester_name || name || "usuario(a)",
    email: ticket.requester_email,
    asunto: ticket.subject,
    ticket: String(ticket.id),
    fecha_solicitud: formatDateEs(new Date(ticket.requested_at)),
    fecha_vence: formatDateEs(ticket.due_date),
    dias_habiles: String(settings.sla_business_days),
    dias_transcurridos: String(businessDaysBetween(toBogotaDate(new Date(ticket.requested_at)), todayBogota())),
    firma: settings.signature,
  };
}

export function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}

/** Asunto de respuesta: "Re: <asunto original>" sin duplicar prefijos. */
export function replySubject(subject: string): string {
  return /^re\s*:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}
