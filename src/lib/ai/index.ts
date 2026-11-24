import "server-only";
import { db } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { stripQuoted } from "@/lib/mail/parse";
import type { Message, ReplySuggestion, Sentiment, Ticket } from "@/lib/types";
import { aiEnabled, AiRateLimit, AiRefusal, generateJson } from "./llm";
import { ClassificationSchema, SuggestionSchema, TriageSchema, type Classification } from "./schemas";
import { CLASSIFY_INSTRUCTIONS, SAFETY, suggestInstructions, TRIAGE_INSTRUCTIONS } from "./prompts";
import { loadThread, ticketFacts, transcript } from "./context";
import { applyClassification, applyTriage, saveSuggestions } from "./apply";

export { aiEnabled } from "./llm";

// ---------------------------------------------------------------------------
// Llamadas al proveedor configurado (DeepSeek / Anthropic). Con AI_PROVIDER=none
// estas funciones no se usan: Claude Code hace el trabajo vía MCP.
// ---------------------------------------------------------------------------

export async function classifyMessage(ticket: Ticket, msg: Message): Promise<Classification | null> {
  try {
    return await generateJson({
      schema: ClassificationSchema,
      depth: "low",
      maxTokens: 2048,
      system: `${CLASSIFY_INSTRUCTIONS}\n${SAFETY}`,
      user: `${ticketFacts(ticket, await getSettings())}

<correo de="${msg.from_email}" asunto="${msg.subject.replace(/"/g, "'")}">
${stripQuoted(msg.text_body).slice(0, 8000)}
</correo>`,
    });
  } catch (e) {
    if (e instanceof AiRefusal) return null;
    throw e;
  }
}

export async function generateSuggestions(ticketId: number, extraInstructions?: string): Promise<ReplySuggestion | null> {
  const [ctx, settings] = await Promise.all([loadThread(ticketId), getSettings()]);
  if (!ctx) throw new Error("Ticket no encontrado");
  try {
    const out = await generateJson({
      schema: SuggestionSchema,
      depth: "high",
      cacheSystem: true,
      system: `${suggestInstructions(settings.response_guidelines, settings.signature)}\n\n${SAFETY}`,
      user: `${ticketFacts(ctx.ticket, settings)}

HILO (más antiguo primero):
${transcript(ctx, { last: 12, maxChars: 6000 })}
${extraInstructions ? `\nINDICACIONES DEL AGENTE: ${extraInstructions}` : ""}`,
    });
    return (await saveSuggestions(ticketId, out, "ai")) as ReplySuggestion;
  } catch (e) {
    if (e instanceof AiRefusal) return null;
    throw e;
  }
}

export async function triageTicket(ticketId: number) {
  const ctx = await loadThread(ticketId);
  if (!ctx) throw new Error("Ticket no encontrado");
  try {
    const r = await generateJson({
      schema: TriageSchema,
      depth: "low",
      maxTokens: 4096,
      system: `${TRIAGE_INSTRUCTIONS}\n${SAFETY}`,
      user: `Ticket #${ctx.ticket.id} · solicitante ${ctx.ticket.requester_email}\n\n${transcript(ctx, { last: 20, maxChars: 3000 })}`,
    });
    await applyTriage(ticketId, r, "sistema:triage");
    return r;
  } catch (e) {
    if (e instanceof AiRefusal) {
      await db().from("tickets").update({ triaged_at: new Date().toISOString(), needs_attention: true }).eq("id", ticketId);
      return null;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Procesos por lotes (cron / script)
// ---------------------------------------------------------------------------

const ANGRY: Sentiment[] = ["molesto", "muy_molesto"];

export async function classifyPending(deadline: number, limit = 10) {
  const report = { classified: 0, suggestions: 0, errors: 0 };
  if (!aiEnabled()) return report;
  const { data: pending } = await db()
    .from("messages")
    .select("*")
    .is("classified_at", null)
    .eq("direction", "in")
    .eq("is_auto", false)
    .not("ticket_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  for (const m of (pending ?? []) as Message[]) {
    if (Date.now() > deadline) break;
    try {
      const { data: ticket } = await db().from("tickets").select("*").eq("id", m.ticket_id).single();
      if (!ticket) continue;
      const c = await classifyMessage(ticket as Ticket, m);
      if (!c) {
        await db().from("messages").update({ classified_at: new Date().toISOString() }).eq("id", m.id);
        continue;
      }
      await applyClassification(m.ticket_id, c, [m.id]);
      report.classified++;
      if (ANGRY.includes(c.sentiment) && Date.now() + 60_000 < deadline) {
        await generateSuggestions(m.ticket_id);
        report.suggestions++;
      }
    } catch (e) {
      report.errors++;
      console.error("Error clasificando mensaje", m.id, e);
      if (e instanceof AiRateLimit) break;
    }
  }
  return report;
}

/** Revisa tickets importados sin triage. `concurrency` > 1 solo para el script de importación. */
export async function triagePending(deadline: number, limit = 5, concurrency = 1) {
  const report = { triaged: 0, errors: 0, remaining: 0 };
  const { data, count } = await db()
    .from("tickets")
    .select("id", { count: "exact" })
    .eq("imported", true)
    .is("triaged_at", null)
    .order("id", { ascending: true })
    .limit(limit);
  report.remaining = count ?? 0;
  if (!aiEnabled()) return report;
  const ids = (data ?? []).map((d) => d.id as number);

  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < ids.length && Date.now() < deadline) {
      const id = ids[next++];
      try {
        await triageTicket(id);
        report.triaged++;
        report.remaining--;
      } catch (e) {
        report.errors++;
        console.error("Error en triage del ticket", id, e);
        if (e instanceof AiRateLimit) stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return report;
}
