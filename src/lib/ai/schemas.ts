import { z } from "zod";

export const INTENTS = [
  "solicitud_examen",
  "consulta_estado",
  "queja",
  "reclamo_legal",
  "envio_documentos",
  "agradecimiento",
  "otro",
] as const;

export const SentimentEnum = z.enum(["neutral", "molesto", "muy_molesto"]);

export const ClassificationSchema = z.object({
  sentiment: SentimentEnum,
  urgency: z.number().int().min(1).max(3).describe("1 normal, 2 alta, 3 crítica"),
  intent: z.enum(INTENTS),
  summary: z.string().describe("Resumen de una o dos frases en español"),
  requester_name: z.string().nullable().describe("Nombre de la persona si aparece en el correo, si no null"),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ReplyOptionSchema = z.object({
  title: z.string().describe("Nombre corto de la estrategia, p.ej. 'Empática con compromiso'"),
  tone: z.string().describe("Tono: empático, formal, conciso, etc."),
  subject: z.string(),
  body: z.string().describe("Cuerpo completo del correo listo para enviar, incluida la firma"),
});

export const SuggestionSchema = z.object({
  analysis: z.string().describe("Análisis breve: qué pide la persona, su estado emocional, riesgos y qué datos faltan"),
  escalate: z.boolean().describe("true si el caso debe escalarse a un supervisor o área legal"),
  options: z.array(ReplyOptionSchema).min(1).max(3),
  recommended_index: z.number().int().min(0).max(2),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const TriageSchema = z.object({
  state: z
    .enum(["entregado", "pendiente_respuesta", "en_espera", "sin_accion"])
    .describe(
      "entregado: ya se enviaron los resultados. pendiente_respuesta: el último mensaje relevante es del cliente y nadie respondió. en_espera: se respondió pero el examen aún no se entrega. sin_accion: spam, publicidad, agradecimiento final u otro tema que no requiere gestión.",
    ),
  delivered: z.boolean(),
  delivered_at: z.string().nullable().describe("Fecha ISO del correo donde se entregaron resultados, o null"),
  delivery_evidence: z.string().nullable().describe("Qué prueba la entrega: p.ej. 'adjunto resultados_juan.pdf el 3-mar'"),
  wait_email_sent: z.boolean().describe("true si ya se envió un correo informando que el examen sigue en proceso / demora"),
  wait_email_at: z.string().nullable().describe("Fecha ISO de ese correo de espera, o null"),
  needs_reply: z.boolean().describe("true si hay un mensaje del cliente que aún espera respuesta"),
  sentiment: SentimentEnum,
  intent: z.enum(INTENTS),
  summary: z.string().describe("Resumen de una o dos frases del caso y su estado actual"),
  requester_name: z.string().nullable(),
  reason: z.string().describe("Explicación breve de la conclusión"),
});
export type Triage = z.infer<typeof TriageSchema>;
