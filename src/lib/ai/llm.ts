import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "@/lib/env";

/**
 * Capa de proveedor de IA dentro de la app (opcional).
 *  - none      → la app no llama a ninguna IA; el trabajo lo hace Claude Code vía MCP.
 *  - deepseek  → API compatible con OpenAI (DEEPSEEK_API_KEY).
 *  - anthropic → API de Claude (ANTHROPIC_API_KEY).
 */
export type Provider = "none" | "deepseek" | "anthropic";

export class AiRefusal extends Error {}
export class AiRateLimit extends Error {}

export type JsonRequest<S extends z.ZodType> = {
  schema: S;
  system: string;
  user: string;
  /** Cuánto razonamiento: bajo para clasificar, alto para redactar. */
  depth: "low" | "high";
  maxTokens?: number;
  /** Texto estable del system que conviene cachear (pautas). */
  cacheSystem?: boolean;
};

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;

async function anthropicJson<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>> {
  anthropicClient ??= new Anthropic();
  try {
    const res = await anthropicClient.beta.messages.parse({
      model: env.anthropicModel(),
      // Si el modelo rechaza, el servidor reintenta con otro modelo
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: req.maxTokens ?? 16000,
      output_config: { effort: req.depth === "low" ? "low" : "high", format: betaZodOutputFormat(req.schema) },
      system: [{ type: "text", text: req.system, ...(req.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}) }],
      messages: [{ role: "user", content: req.user }],
    });
    if (res.stop_reason === "refusal" || res.parsed_output == null) throw new AiRefusal("El modelo no respondió");
    return res.parsed_output as z.infer<S>;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiRateLimit(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// DeepSeek (OpenAI-compatible, modo JSON)
// ---------------------------------------------------------------------------

async function deepseekJson<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(req.schema), null, 1);
  const system = `${req.system}

Responde ÚNICAMENTE con un objeto JSON válido que cumpla este JSON Schema (sin texto adicional, sin markdown):
${jsonSchema}`;

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${env.deepseekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.deepseekApiKey()}` },
      body: JSON.stringify({
        model: req.depth === "high" ? env.deepseekModelHigh() : env.deepseekModel(),
        max_tokens: Math.min(req.maxTokens ?? 8000, 8000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: attempt === 0 ? req.user : `${req.user}\n\nTu respuesta anterior no cumplió el esquema (${lastError}). Devuelve solo el JSON correcto.`,
          },
        ],
      }),
    });
    if (res.status === 429) throw new AiRateLimit("DeepSeek: límite de solicitudes");
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = req.schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300);
    } catch {
      lastError = "JSON inválido";
    }
  }
  throw new Error(`DeepSeek devolvió una respuesta inválida: ${lastError}`);
}

// ---------------------------------------------------------------------------

export function provider(): Provider {
  return env.aiProvider();
}

export function aiEnabled(): boolean {
  return provider() !== "none";
}

export async function generateJson<S extends z.ZodType>(req: JsonRequest<S>): Promise<z.infer<S>> {
  switch (provider()) {
    case "anthropic":
      return anthropicJson(req);
    case "deepseek":
      return deepseekJson(req);
    default:
      throw new Error("No hay proveedor de IA configurado (AI_PROVIDER). Use Claude Code vía MCP.");
  }
}
