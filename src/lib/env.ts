import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),

  mailAddress: () => req("MAIL_ADDRESS").toLowerCase(),
  mailFromName: () => process.env.MAIL_FROM_NAME ?? "Exámenes CENTIC",
  mailUser: () => process.env.MAIL_USER ?? req("MAIL_ADDRESS"),
  mailPassword: () => req("MAIL_PASSWORD"),

  imapHost: () => req("IMAP_HOST"),
  imapPort: () => Number(process.env.IMAP_PORT ?? 993),
  imapInbox: () => process.env.IMAP_INBOX ?? "INBOX",
  /** Si no se define, se detecta por specialUse \Sent. En cPanel suele ser "INBOX.Sent". */
  imapSentMailbox: () => process.env.IMAP_SENT_MAILBOX,
  /** 0 = traer TODO el histórico en la primera sincronización. */
  initialSyncDays: () => Number(process.env.INITIAL_SYNC_DAYS ?? 0),
  /** Correos más antiguos que esto se consideran históricos: no se clasifican uno a uno ni disparan IA. */
  historicDays: () => Number(process.env.HISTORIC_DAYS ?? 3),
  /** Guardar archivos adjuntos de correos históricos en Storage (por defecto solo metadata). */
  backfillAttachments: () => process.env.BACKFILL_ATTACHMENTS === "true",

  // ---- Gmail (opcional): cuenta que ha venido gestionando el buzón ----
  gmailUser: () => process.env.GMAIL_USER?.toLowerCase(),
  gmailAppPassword: () => process.env.GMAIL_APP_PASSWORD,
  /** Carpeta a leer. Por defecto se detecta "Todos" (\All). */
  gmailMailbox: () => process.env.GMAIL_MAILBOX,
  /** Filtro de búsqueda Gmail (X-GM-RAW). Por defecto: todo lo que sea de/para MAIL_ADDRESS. */
  gmailFilter: () => process.env.GMAIL_FILTER,

  /** Direcciones "nuestras": lo que salga de ellas es respuesta (salida), no solicitud. */
  ownAddresses: (): string[] => {
    const list = [
      process.env.MAIL_ADDRESS,
      process.env.GMAIL_USER,
      ...(process.env.OWN_ADDRESSES ?? "").split(","),
    ];
    return [...new Set(list.map((s) => s?.trim().toLowerCase()).filter((s): s is string => !!s))];
  },

  smtpHost: () => req("SMTP_HOST"),
  smtpPort: () => Number(process.env.SMTP_PORT ?? 465),

  cronSecret: () => req("CRON_SECRET"),
  mcpToken: () => req("MCP_TOKEN"),
  /**
   * IA dentro de la app. Por defecto "none": el trabajo lo hace Claude Code vía MCP.
   * Si AI_PROVIDER no se define, se usa el que tenga clave configurada.
   */
  aiProvider: (): "none" | "deepseek" | "anthropic" => {
    const p = process.env.AI_PROVIDER?.toLowerCase();
    if (p === "deepseek" || p === "anthropic" || p === "none") return p;
    if (process.env.DEEPSEEK_API_KEY) return "deepseek";
    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    return "none";
  },
  aiEnabled: (): boolean => env.aiProvider() !== "none",
  anthropicModel: () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  deepseekApiKey: () => req("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: () => (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, ""),
  deepseekModel: () => process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  /** Modelo para redactar respuestas (p.ej. "deepseek-reasoner"). Por defecto el mismo. */
  deepseekModelHigh: () => process.env.DEEPSEEK_MODEL_HIGH ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
};
