import "server-only";
import { ImapFlow } from "imapflow";
import { env } from "@/lib/env";

export type Account = "cpanel" | "gmail";

export function gmailConfigured() {
  return !!(env.gmailUser() && env.gmailAppPassword());
}

export function imapClient(account: Account = "cpanel") {
  if (account === "gmail") {
    return new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: env.gmailUser()!, pass: env.gmailAppPassword()! },
      logger: false,
    });
  }
  return new ImapFlow({
    host: env.imapHost(),
    port: env.imapPort(),
    secure: true,
    auth: { user: env.mailUser(), pass: env.mailPassword() },
    logger: false,
  });
}

/** Ejecuta fn con un cliente IMAP conectado y lo cierra al final. */
export async function withImap<T>(fn: (client: ImapFlow) => Promise<T>, account: Account = "cpanel"): Promise<T> {
  const client = imapClient(account);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Carpeta de enviados: env IMAP_SENT_MAILBOX, specialUse \Sent o "INBOX.Sent" (cPanel). */
export async function resolveSentMailbox(client: ImapFlow): Promise<string> {
  const fromEnv = env.imapSentMailbox();
  if (fromEnv) return fromEnv;
  const list = await client.list();
  const sent = list.find((m) => m.specialUse === "\\Sent");
  if (sent) return sent.path;
  const byName = list.find((m) => /(^|\.|\/)(sent|enviados)$/i.test(m.path));
  return byName?.path ?? "INBOX.Sent";
}

/** Gmail: carpeta "Todos" / "All Mail" (incluye recibidos y enviados; excluye spam y papelera). */
export async function resolveGmailAllMailbox(client: ImapFlow): Promise<string> {
  const fromEnv = env.gmailMailbox();
  if (fromEnv) return fromEnv;
  const list = await client.list();
  const all = list.find((m) => m.specialUse === "\\All");
  return all?.path ?? "[Gmail]/All Mail";
}

export function defaultGmailFilter(): string {
  const a = env.mailAddress();
  return env.gmailFilter() ?? `from:${a} OR to:${a} OR cc:${a} OR deliveredto:${a}`;
}
