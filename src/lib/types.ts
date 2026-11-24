export type TicketStatus = "abierto" | "en_proceso" | "entregado" | "cerrado";
export type Sentiment = "neutral" | "molesto" | "muy_molesto";

export type Ticket = {
  id: number;
  requester_email: string;
  requester_name: string | null;
  subject: string;
  normalized_subject: string;
  status: TicketStatus;
  sentiment: Sentiment;
  urgency: number;
  intent: string | null;
  ai_summary: string | null;
  needs_attention: boolean;
  requested_at: string;
  due_date: string;
  wait_sent_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  imported: boolean;
  triaged_at: string | null;
  triage: TriageResult | null;
  created_at: string;
};

export type TriageResult = {
  state: "entregado" | "pendiente_respuesta" | "en_espera" | "sin_accion";
  delivered: boolean;
  delivered_at: string | null;
  delivery_evidence: string | null;
  wait_email_sent: boolean;
  wait_email_at: string | null;
  needs_reply: boolean;
  reason: string;
};

export type Message = {
  id: number;
  ticket_id: number;
  direction: "in" | "out";
  message_id: string;
  in_reply_to: string | null;
  references_ids: string[];
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  text_body: string;
  html_body: string | null;
  sent_at: string;
  is_auto: boolean;
  sent_by: string | null;
};

export type Attachment = {
  id: number;
  message_id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
};

export type ReplyOption = { title: string; tone: string; subject: string; body: string };

export type ReplySuggestion = {
  id: number;
  ticket_id: number;
  source: "ai" | "mcp";
  analysis: string;
  options: ReplyOption[];
  recommended_index: number | null;
  escalate: boolean;
  used_index: number | null;
  created_at: string;
};

export type Template = { id: number; key: string; name: string; subject: string; body: string };

export const STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: "Abierto",
  en_proceso: "En proceso",
  entregado: "Entregado",
  cerrado: "Cerrado",
};

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  neutral: "Neutral",
  molesto: "Molesto",
  muy_molesto: "Muy molesto",
};
