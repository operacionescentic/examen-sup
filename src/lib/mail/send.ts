import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { resolveSentMailbox, withImap } from "@/lib/mail/imap";
import type { Message, Ticket } from "@/lib/types";

export type OutgoingAttachment = { filename: string; contentType: string; content: Buffer };

export type SendReplyInput = {
  ticket: Ticket;
  subject: string;
  body: string;
  cc?: string[];
  attachments?: OutgoingAttachment[];
  sentBy: string; // email del agente o "sistema:sla"
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function textToHtml(text: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

let transporter: Transporter | null = null;
function smtp() {
  if (!transporter) {
    const port = env.smtpPort();
    transporter = nodemailer.createTransport({
      host: env.smtpHost(),
      port,
      secure: port === 465,
      auth: { user: env.mailUser(), pass: env.mailPassword() },
    });
  }
  return transporter;
}

/**
 * Responde dentro del hilo del ticket:
 * 1) arma el MIME con In-Reply-To/References,
 * 2) lo envía por SMTP,
 * 3) lo guarda en la carpeta Enviados vía IMAP (para verlo en webmail),
 * 4) lo registra en la BD.
 */
export async function sendReply(input: SendReplyInput): Promise<Message> {
  const { ticket } = input;
  const domain = env.mailAddress().split("@")[1];
  const messageId = `<${randomUUID()}@${domain}>`;

  const { data: thread } = await db()
    .from("messages")
    .select("message_id, direction")
    .eq("ticket_id", ticket.id)
    .order("sent_at", { ascending: true });

  const ids = (thread ?? []).map((m) => m.message_id as string);
  const lastInbound = [...(thread ?? [])].reverse().find((m) => m.direction === "in");
  const inReplyTo = (lastInbound?.message_id as string | undefined) ?? ids.at(-1);
  const references = ids.slice(-20);

  const mail = {
    from: { name: env.mailFromName(), address: env.mailAddress() },
    to: ticket.requester_name
      ? { name: ticket.requester_name, address: ticket.requester_email }
      : ticket.requester_email,
    cc: input.cc?.length ? input.cc : undefined,
    subject: input.subject,
    text: input.body,
    html: textToHtml(input.body),
    messageId,
    inReplyTo,
    references: references.length ? references : undefined,
    date: new Date(),
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
  };

  const raw = await new MailComposer(mail).compile().build();
  const recipients = [ticket.requester_email, ...(input.cc ?? [])];

  await smtp().sendMail({
    envelope: { from: env.mailAddress(), to: recipients },
    raw,
  });

  // Copia en Enviados (no bloqueante si falla)
  let mailbox: string | null = null;
  try {
    await withImap(async (client) => {
      mailbox = await resolveSentMailbox(client);
      await client.append(mailbox, raw, ["\\Seen"]);
    });
  } catch (e) {
    console.error("No se pudo guardar copia en Enviados", e);
  }

  const now = new Date().toISOString();
  const { data: msg, error } = await db()
    .from("messages")
    .insert({
      ticket_id: ticket.id,
      direction: "out",
      message_id: messageId,
      in_reply_to: inReplyTo ?? null,
      references_ids: references,
      from_email: env.mailAddress(),
      from_name: env.mailFromName(),
      to_emails: [ticket.requester_email],
      cc_emails: input.cc ?? [],
      subject: input.subject,
      text_body: input.body,
      html_body: mail.html,
      sent_at: now,
      mailbox,
      is_auto: input.sentBy.startsWith("sistema:"),
      sent_by: input.sentBy,
      classified_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (input.attachments?.length) {
    for (const a of input.attachments) {
      const path = `${ticket.id}/${msg.id}/${a.filename}`;
      const up = await db().storage.from("attachments").upload(path, a.content, {
        contentType: a.contentType,
        upsert: true,
      });
      if (!up.error) {
        await db().from("attachments").insert({
          message_id: msg.id,
          filename: a.filename,
          content_type: a.contentType,
          size_bytes: a.content.length,
          storage_path: path,
        });
      }
    }
  }

  await db()
    .from("tickets")
    .update({
      last_message_at: now,
      needs_attention: false,
      status: ticket.status === "abierto" ? "en_proceso" : ticket.status,
    })
    .eq("id", ticket.id);

  await db().from("audit_log").insert({
    ticket_id: ticket.id,
    actor: input.sentBy,
    action: "reply_sent",
    details: { subject: input.subject, attachments: input.attachments?.map((a) => a.filename) ?? [] },
  });

  return msg as Message;
}
