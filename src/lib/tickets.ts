import "server-only";
import { db } from "@/lib/supabase/admin";
import { addBusinessDays, todayBogota } from "@/lib/business-days";
import type { Attachment, Message, ReplySuggestion, Ticket } from "@/lib/types";

export const FILTERS = {
  atencion: "Necesitan atención",
  molestos: "Molestos",
  por_vencer: "Por vencer (≤2 días hábiles)",
  vencidos: "Vencidos",
  abiertos: "Abiertos",
  entregados: "Entregados",
  cerrados: "Cerrados",
  por_revisar: "Importados sin revisar",
  todos: "Todos",
} as const;
export type FilterKey = keyof typeof FILTERS;

export type ListOptions = { filter?: FilterKey; q?: string; limit?: number; offset?: number };

export async function listTickets({ filter = "atencion", q, limit = 50, offset = 0 }: ListOptions = {}) {
  const today = todayBogota();
  let query = db().from("tickets").select("*", { count: "exact" });

  const active = ["abierto", "en_proceso"];
  switch (filter) {
    case "atencion":
      query = query.eq("needs_attention", true).in("status", active);
      break;
    case "molestos":
      query = query.neq("sentiment", "neutral").in("status", active);
      break;
    case "por_vencer":
      query = query
        .in("status", active)
        .is("delivered_at", null)
        .gt("due_date", today)
        .lte("due_date", addBusinessDays(today, 2));
      break;
    case "vencidos":
      query = query.in("status", active).is("delivered_at", null).lte("due_date", today);
      break;
    case "abiertos":
      query = query.in("status", active);
      break;
    case "entregados":
      query = query.eq("status", "entregado");
      break;
    case "cerrados":
      query = query.eq("status", "cerrado");
      break;
    case "por_revisar":
      query = query.eq("imported", true).is("triaged_at", null);
      break;
  }

  if (q?.trim()) {
    const term = q.trim().replace(/[%,()]/g, " ");
    const asId = Number(term.replace(/^#/, ""));
    if (Number.isInteger(asId) && asId > 0) {
      query = query.eq("id", asId);
    } else {
      // Busca en tickets + texto completo de mensajes
      const { data: hits } = await db()
        .from("messages")
        .select("ticket_id")
        .textSearch("search", term, { type: "websearch", config: "spanish" })
        .limit(200);
      const ids = [...new Set((hits ?? []).map((h) => h.ticket_id as number))];
      const orParts = [`requester_email.ilike.%${term}%`, `requester_name.ilike.%${term}%`, `subject.ilike.%${term}%`];
      if (ids.length) orParts.push(`id.in.(${ids.join(",")})`);
      query = query.or(orParts.join(","));
    }
  }

  const { data, count, error } = await query
    .order("last_message_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { tickets: (data ?? []) as Ticket[], count: count ?? 0 };
}

export async function countByFilter(): Promise<Record<FilterKey, number>> {
  const keys = Object.keys(FILTERS) as FilterKey[];
  const entries = await Promise.all(
    keys.map(async (k) => [k, (await listTickets({ filter: k, limit: 1 })).count] as const),
  );
  return Object.fromEntries(entries) as Record<FilterKey, number>;
}

export async function getTicketDetail(id: number) {
  const [{ data: ticket }, { data: messages }, { data: suggestions }] = await Promise.all([
    db().from("tickets").select("*").eq("id", id).maybeSingle(),
    db().from("messages").select("*").eq("ticket_id", id).order("sent_at", { ascending: true }),
    db().from("reply_suggestions").select("*").eq("ticket_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  if (!ticket) return null;
  const msgIds = (messages ?? []).map((m) => m.id as number);
  const { data: attachments } = msgIds.length
    ? await db().from("attachments").select("*").in("message_id", msgIds)
    : { data: [] };
  return {
    ticket: ticket as Ticket,
    messages: (messages ?? []) as Message[],
    attachments: (attachments ?? []) as Attachment[],
    suggestions: (suggestions ?? []) as ReplySuggestion[],
  };
}

export async function updateTicket(id: number, patch: Partial<Ticket>, actor: string, action: string) {
  const { error } = await db().from("tickets").update(patch).eq("id", id);
  if (error) throw error;
  await db().from("audit_log").insert({ ticket_id: id, actor, action, details: patch });
}
