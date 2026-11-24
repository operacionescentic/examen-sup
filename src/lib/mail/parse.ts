import "server-only";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

export type Addr = { email: string; name: string | null };

function flatten(a: AddressObject | AddressObject[] | undefined): Addr[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.flatMap((o) =>
    o.value.flatMap((v) =>
      v.address ? [{ email: v.address.toLowerCase(), name: v.name || null }] : [],
    ),
  );
}

export type ParsedEmail = {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  text: string;
  html: string | null;
  date: Date;
  isAuto: boolean;
  attachments: { filename: string; contentType: string; size: number; content: Buffer }[];
};

function header(p: ParsedMail, name: string): string {
  const v = p.headers.get(name);
  if (v == null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Correos automáticos: autorespuestas, rebotes, listas. No crean tickets ni se clasifican. */
function detectAuto(p: ParsedMail, from: string): boolean {
  const auto = header(p, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (p.headers.has("x-autoreply") || p.headers.has("x-autorespond")) return true;
  const prec = header(p, "precedence").toLowerCase();
  if (["bulk", "junk", "list", "auto_reply"].includes(prec)) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|noreply)@/i.test(from)) return true;
  return false;
}

/** Texto plano a partir de HTML (fallback cuando no hay parte text/plain). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEmail(source: Buffer, fallbackId: string): Promise<ParsedEmail> {
  const p = await simpleParser(source);
  const from = flatten(p.from)[0] ?? { email: "desconocido@invalid", name: null };
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const html = typeof p.html === "string" ? p.html : null;
  return {
    messageId: p.messageId ?? `<${fallbackId}@sin-message-id>`,
    inReplyTo: p.inReplyTo ?? null,
    references: refs,
    from,
    to: flatten(p.to),
    cc: flatten(p.cc),
    subject: p.subject ?? "",
    text: p.text?.trim() || (html ? htmlToText(html) : ""),
    html,
    date: p.date ?? new Date(),
    isAuto: detectAuto(p, from.email),
    attachments: p.attachments
      .filter((a) => a.contentDisposition !== "inline" || !a.cid)
      .map((a) => ({
        filename: a.filename ?? "adjunto",
        contentType: a.contentType,
        size: a.size,
        content: a.content,
      })),
  };
}

/** "RE: Fwd: Solicitud examen" → "solicitud examen" */
export function normalizeSubject(s: string): string {
  let out = s.trim();
  const prefix = /^(re|rv|fw|fwd|reenviar|respuesta|aw|tr)\s*(\[\d+\])?\s*:\s*/i;
  while (prefix.test(out)) out = out.replace(prefix, "");
  return out.replace(/\s+/g, " ").toLowerCase();
}

/** Quita el historial citado ("El lun, ... escribió:") para enviar menos texto a la IA. */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex(
    (l) =>
      /^(El|On)\s.+(escribió|wrote):\s*$/i.test(l.trim()) ||
      /^-{2,}\s*(Mensaje original|Original Message)/i.test(l.trim()) ||
      /^De:\s.+/i.test(l.trim()) && lines.some((x) => /^Enviado:|^Sent:/i.test(x.trim())),
  );
  const body = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">"));
  return body.join("\n").trim();
}
