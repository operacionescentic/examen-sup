import "server-only";
import type { ImapFlow } from "imapflow";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import {
  defaultGmailFilter,
  gmailConfigured,
  resolveGmailAllMailbox,
  resolveSentMailbox,
  withImap,
  type Account,
} from "@/lib/mail/imap";
import { normalizeSubject, parseEmail, type ParsedEmail } from "@/lib/mail/parse";
import { addBusinessDays, toBogotaDate } from "@/lib/business-days";
import { getSettings } from "@/lib/settings";

const THREAD_WINDOW_DAYS = 90;
const FETCH_CHUNK = 25;

export type SyncReport = {
  source: string;
  fetched: number;
  inserted: number;
  newTickets: number;
  skipped: number;
  remaining: number;
  error?: string;
};

export type SyncOptions = {
  /** Tiempo máximo total en ms. */
  budgetMs?: number;
  /** Máximo de mensajes por carpeta en esta ejecución. */
  maxPerMailbox?: number;
  /** Para logs del script de importación. */
  onProgress?: (r: SyncReport) => void;
};

type Ctx = { deadline: number; slaDays: number; own: Set<string> };

// ---------------------------------------------------------------------------
// Hilos
// ---------------------------------------------------------------------------

async function findTicketByReferences(p: ParsedEmail): Promise<number | null> {
  const refs = [p.inReplyTo, ...p.references].filter(Boolean) as string[];
  if (!refs.length) return null;
  const { data } = await db()
    .from("messages")
    .select("ticket_id")
    .in("message_id", refs.slice(-30))
    .not("ticket_id", "is", null)
    .limit(1);
  return (data?.[0]?.ticket_id as number | undefined) ?? null;
}

/** Mismo solicitante + mismo asunto normalizado, cerca en el tiempo (relativo a la fecha del correo). */
async function findTicketBySubject(email: string, subject: string, at: Date): Promise<number | null> {
  const norm = normalizeSubject(subject);
  if (!norm) return null;
  const from = new Date(at.getTime() - THREAD_WINDOW_DAYS * 86400000).toISOString();
  const to = new Date(at.getTime() + THREAD_WINDOW_DAYS * 86400000).toISOString();
  const { data } = await db()
    .from("tickets")
    .select("id")
    .eq("requester_email", email)
    .eq("normalized_subject", norm)
    .gte("last_message_at", from)
    .lte("requested_at", to)
    .order("last_message_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.id as number | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function isHistoric(p: ParsedEmail) {
  return p.date.getTime() < Date.now() - env.historicDays() * 86400000;
}

async function storeAttachments(ticketId: number | null, messageDbId: number, p: ParsedEmail) {
  const keepFiles = !isHistoric(p) || env.backfillAttachments();
  for (const a of p.attachments) {
    let path: string | null = null;
    if (keepFiles) {
      const safe = a.filename.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "adjunto";
      path = `${ticketId ?? "huerfanos"}/${messageDbId}/${safe}`;
      const up = await db().storage.from("attachments").upload(path, a.content, {
        contentType: a.contentType,
        upsert: true,
      });
      if (up.error) {
        console.error("Error subiendo adjunto", path, up.error.message);
        path = null;
      }
    }
    await db().from("attachments").insert({
      message_id: messageDbId,
      filename: a.filename,
      content_type: a.contentType,
      size_bytes: a.size,
      storage_path: path,
    });
  }
}

async function insertMessage(
  ticketId: number | null,
  direction: "in" | "out",
  p: ParsedEmail,
  source: string,
  uid: number,
) {
  const historic = isHistoric(p);
  const { data, error } = await db()
    .from("messages")
    .insert({
      ticket_id: ticketId,
      direction,
      message_id: p.messageId,
      in_reply_to: p.inReplyTo,
      references_ids: p.references,
      from_email: p.from.email,
      from_name: p.from.name,
      to_emails: p.to.map((a) => a.email),
      cc_emails: p.cc.map((a) => a.email),
      subject: p.subject,
      text_body: p.text,
      html_body: p.html,
      sent_at: p.date.toISOString(),
      mailbox: source,
      imap_uid: uid,
      is_auto: p.isAuto,
      sent_by: direction === "out" ? (source.startsWith("gmail") ? "gmail" : "webmail") : null,
      // Salientes, automáticos e históricos no se clasifican uno a uno (los históricos van por triage)
      classified_at: direction === "out" || p.isAuto || historic ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // duplicado (mismo Message-ID desde otra fuente)
    throw error;
  }
  return data.id as number;
}

/** Recalcula fechas y banderas del ticket a partir de sus mensajes (necesario cuando llegan fuera de orden). */
export async function recomputeTicket(ticketId: number, slaDays: number) {
  const [{ data: t }, { data: msgs }] = await Promise.all([
    db().from("tickets").select("requested_at, wait_sent_at, status").eq("id", ticketId).single(),
    db()
      .from("messages")
      .select("direction, sent_at, is_auto")
      .eq("ticket_id", ticketId)
      .order("sent_at", { ascending: true }),
  ]);
  if (!t || !msgs?.length) return;
  const human = msgs.filter((m) => !m.is_auto);
  const firstIn = human.find((m) => m.direction === "in");
  const lastIn = [...human].reverse().find((m) => m.direction === "in");
  const last = human.at(-1) ?? msgs.at(-1)!;
  const requestedAt = (firstIn?.sent_at as string | undefined) ?? (t.requested_at as string);

  const patch: Record<string, unknown> = {
    requested_at: requestedAt,
    last_message_at: msgs.at(-1)!.sent_at,
    last_inbound_at: lastIn?.sent_at ?? null,
  };
  if (!t.wait_sent_at) patch.due_date = addBusinessDays(toBogotaDate(new Date(requestedAt)), slaDays);
  if (t.status === "abierto" || t.status === "en_proceso") {
    patch.needs_attention = last.direction === "in";
  }
  await db().from("tickets").update(patch).eq("id", ticketId);
}

async function ingest(p: ParsedEmail, source: string, uid: number, ctx: Ctx) {
  const outbound = ctx.own.has(p.from.email);
  const historic = isHistoric(p);

  if (outbound) {
    // Respuesta nuestra: al hilo existente; si aún no existe, queda huérfana y se re-enlaza luego
    let ticketId = await findTicketByReferences(p);
    if (!ticketId) {
      const to = p.to.find((a) => !ctx.own.has(a.email))?.email;
      if (to) ticketId = await findTicketBySubject(to, p.subject, p.date);
    }
    const msgId = await insertMessage(ticketId, "out", p, source, uid);
    if (!msgId) return { inserted: false, newTicket: false, ticketId };
    await storeAttachments(ticketId, msgId, p);
    if (ticketId) await recomputeTicket(ticketId, ctx.slaDays);
    return { inserted: true, newTicket: false, ticketId };
  }

  let ticketId = (await findTicketByReferences(p)) ?? (await findTicketBySubject(p.from.email, p.subject, p.date));
  let newTicket = false;

  if (!ticketId) {
    if (p.isAuto) return { inserted: false, newTicket: false, ticketId: null }; // rebotes/autorespuestas sueltas
    const { data, error } = await db()
      .from("tickets")
      .insert({
        requester_email: p.from.email,
        requester_name: p.from.name,
        subject: p.subject,
        normalized_subject: normalizeSubject(p.subject),
        requested_at: p.date.toISOString(),
        due_date: addBusinessDays(toBogotaDate(p.date), ctx.slaDays),
        last_message_at: p.date.toISOString(),
        last_inbound_at: p.date.toISOString(),
        imported: historic,
      })
      .select("id")
      .single();
    if (error) throw error;
    ticketId = data.id as number;
    newTicket = true;
  }

  const msgId = await insertMessage(ticketId, "in", p, source, uid);
  if (!msgId) return { inserted: false, newTicket, ticketId };
  await storeAttachments(ticketId, msgId, p);

  if (!newTicket && !p.isAuto && !historic) {
    // Correo nuevo en vivo sobre un ticket existente: reabre si estaba cerrado/entregado
    const { data: t } = await db().from("tickets").select("status").eq("id", ticketId).single();
    if (t && (t.status === "cerrado" || t.status === "entregado")) {
      await db().from("tickets").update({ status: "en_proceso", closed_at: null }).eq("id", ticketId);
    }
  }
  await recomputeTicket(ticketId, ctx.slaDays);
  return { inserted: true, newTicket, ticketId };
}

/** Intenta enlazar respuestas huérfanas a su ticket (cuando el original llegó después). */
export async function relinkOrphans(slaDays: number, limit = 200) {
  const { data } = await db()
    .from("messages")
    .select("id, in_reply_to, references_ids, to_emails, subject, sent_at")
    .is("ticket_id", null)
    .limit(limit);
  let linked = 0;
  for (const m of data ?? []) {
    const refs = [m.in_reply_to, ...(m.references_ids ?? [])].filter(Boolean) as string[];
    let ticketId: number | null = null;
    if (refs.length) {
      const { data: hit } = await db()
        .from("messages")
        .select("ticket_id")
        .in("message_id", refs.slice(-30))
        .not("ticket_id", "is", null)
        .limit(1);
      ticketId = (hit?.[0]?.ticket_id as number | undefined) ?? null;
    }
    if (!ticketId && m.to_emails?.[0]) {
      ticketId = await findTicketBySubject(m.to_emails[0], m.subject, new Date(m.sent_at));
    }
    if (ticketId) {
      await db().from("messages").update({ ticket_id: ticketId }).eq("id", m.id);
      await recomputeTicket(ticketId, slaDays);
      linked++;
    }
  }
  return linked;
}

// ---------------------------------------------------------------------------
// Sincronización por carpeta
// ---------------------------------------------------------------------------

type Source = { key: string; account: Account; resolve: (c: ImapFlow) => Promise<string>; gmraw?: string };

function sources(): Source[] {
  const list: Source[] = [];
  // Gmail primero: contiene recibidos + enviados en orden cronológico (menos huérfanos)
  if (gmailConfigured()) {
    const filter = defaultGmailFilter();
    list.push({ key: "gmail", account: "gmail", resolve: resolveGmailAllMailbox, gmraw: filter || undefined });
  }
  list.push({ key: "cpanel:inbox", account: "cpanel", resolve: async () => env.imapInbox() });
  list.push({ key: "cpanel:sent", account: "cpanel", resolve: resolveSentMailbox });
  return list;
}

async function syncSource(client: ImapFlow, src: Source, ctx: Ctx, opts: SyncOptions): Promise<SyncReport> {
  const report: SyncReport = { source: src.key, fetched: 0, inserted: 0, newTickets: 0, skipped: 0, remaining: 0 };
  const mailbox = await src.resolve(client);
  const stateKey = `${src.key}:${mailbox}`;
  const lock = await client.getMailboxLock(mailbox);
  try {
    const box = client.mailbox;
    if (!box) throw new Error(`No se pudo abrir ${mailbox}`);
    const uidValidity = Number(box.uidValidity);

    const { data: state } = await db().from("sync_state").select("*").eq("mailbox", stateKey).maybeSingle();
    const sameValidity = state && Number(state.uid_validity) === uidValidity;
    const lastUid = sameValidity ? Number(state.last_uid) : 0;

    const query: Record<string, unknown> = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : {};
    if (lastUid === 0 && env.initialSyncDays() > 0) {
      query.since = new Date(Date.now() - env.initialSyncDays() * 86400000);
    }
    if (lastUid === 0 && !query.since) query.all = true;
    if (src.gmraw) query.gmraw = src.gmraw;

    const found = ((await client.search(query, { uid: true })) || []).filter((u) => u > lastUid).sort((a, b) => a - b);
    const max = opts.maxPerMailbox ?? 40;
    const batch = found.slice(0, max);
    report.remaining = found.length;

    const saveCursor = async (uid: number) => {
      await db().from("sync_state").upsert({
        mailbox: stateKey,
        uid_validity: uidValidity,
        last_uid: uid,
        last_run_at: new Date().toISOString(),
        last_error: null,
      });
    };

    for (let i = 0; i < batch.length; i += FETCH_CHUNK) {
      if (Date.now() > ctx.deadline) break;
      const chunk = batch.slice(i, i + FETCH_CHUNK);
      // Descarga el bloque completo primero (no se pueden mezclar comandos IMAP dentro de fetch)
      const downloaded: { uid: number; source: Buffer }[] = [];
      for await (const msg of client.fetch(chunk.join(","), { source: true, uid: true }, { uid: true })) {
        if (msg.source) downloaded.push({ uid: msg.uid, source: msg.source });
      }
      downloaded.sort((a, b) => a.uid - b.uid);

      for (const { uid, source } of downloaded) {
        report.fetched++;
        const parsed = await parseEmail(source, `${stateKey}-${uidValidity}-${uid}`);
        const { data: exists } = await db().from("messages").select("id").eq("message_id", parsed.messageId).maybeSingle();
        if (exists) {
          report.skipped++;
        } else {
          const r = await ingest(parsed, src.key, uid, ctx);
          if (r.inserted) report.inserted++;
          else report.skipped++;
          if (r.newTicket) report.newTickets++;
        }
        report.remaining--;
      }
      // Avanza el cursor al final del bloque: si se corta por tiempo, retoma aquí
      await saveCursor(chunk.at(-1)!);
      opts.onProgress?.(report);
    }
    if (batch.length === 0) await saveCursor(lastUid);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    await db()
      .from("sync_state")
      .upsert({ mailbox: stateKey, last_error: report.error, last_run_at: new Date().toISOString() }, { onConflict: "mailbox" });
  } finally {
    lock.release();
  }
  return report;
}

/** Sincroniza todas las fuentes (Gmail si está configurado, INBOX y Enviados de cPanel). */
export async function syncAll(opts: SyncOptions = {}): Promise<SyncReport[]> {
  const settings = await getSettings();
  const ctx: Ctx = {
    deadline: Date.now() + (opts.budgetMs ?? 45_000),
    slaDays: settings.sla_business_days,
    own: new Set(env.ownAddresses()),
  };
  const reports: SyncReport[] = [];
  const byAccount = new Map<Account, Source[]>();
  for (const s of sources()) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s]);

  for (const [account, list] of byAccount) {
    try {
      await withImap(async (client) => {
        for (const src of list) {
          if (Date.now() > ctx.deadline) break;
          reports.push(await syncSource(client, src, ctx, opts));
        }
      }, account);
    } catch (e) {
      reports.push({
        source: account,
        fetched: 0,
        inserted: 0,
        newTickets: 0,
        skipped: 0,
        remaining: 0,
        error: `Conexión ${account}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  await relinkOrphans(ctx.slaDays);
  return reports;
}
