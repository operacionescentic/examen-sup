"use client";

import { useActionState, useState, useTransition } from "react";
import { generateSuggestionsAction, sendReplyAction, type SendState } from "@/app/(app)/actions";
import type { ReplySuggestion } from "@/lib/types";

type Tpl = { key: string; name: string; subject: string; body: string };

export function ReplyWorkspace(props: {
  ticketId: number;
  defaultSubject: string;
  signature: string;
  aiEnabled: boolean;
  suggestions: ReplySuggestion[];
  templates: Tpl[];
}) {
  const [subject, setSubject] = useState(props.defaultSubject);
  const [body, setBody] = useState(`\n\n${props.signature}`);
  const [picked, setPicked] = useState<{ suggestionId: number; index: number } | null>(null);
  const [instructions, setInstructions] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [generating, startGen] = useTransition();
  // React resetea los campos no controlados (cc, adjuntos) al terminar la acción
  const [state, action, sending] = useActionState<SendState, FormData>(async (prev, fd) => {
    const r = await sendReplyAction(prev, fd);
    if (r?.ok) {
      setBody(`\n\n${props.signature}`);
      setPicked(null);
    }
    return r;
  }, undefined);

  const latest = props.suggestions[0];

  return (
    <div className="space-y-4">
      {/* --------- Opciones IA --------- */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Opciones de respuesta</h2>
          {latest && (
            <span className="text-xs text-slate-400">
              {latest.source === "mcp" ? "vía Claude (MCP)" : "IA"} ·{" "}
              {new Date(latest.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
            </span>
          )}
        </div>

        {latest ? (
          <div className="space-y-3">
            {latest.escalate && (
              <div className="rounded-md bg-red-50 p-2 text-xs font-medium text-red-700">⚠ Se recomienda escalar este caso</div>
            )}
            <p className="whitespace-pre-wrap text-xs text-slate-600">{latest.analysis}</p>
            <div className="space-y-2">
              {latest.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setSubject(o.subject || props.defaultSubject);
                    setBody(o.body);
                    setPicked({ suggestionId: latest.id, index: i });
                  }}
                  className={`w-full rounded-md border p-2 text-left text-xs hover:border-slate-500 ${
                    picked?.suggestionId === latest.id && picked.index === i ? "border-slate-900 bg-slate-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong>
                      {i + 1}. {o.title}
                    </strong>
                    {latest.recommended_index === i && <span className="badge bg-emerald-100 text-emerald-800">recomendada</span>}
                  </div>
                  <div className="text-slate-500">{o.tone}</div>
                  <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-slate-600">{o.body}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Sin opciones todavía.</p>
        )}

        {!props.aiEnabled && (
          <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
            Pídele a Claude Code: <code>propón respuestas para el ticket #{props.ticketId}</code> o ejecuta{" "}
            <code>/mcp__helpdesk__molestos</code>. Las opciones aparecerán aquí.
          </p>
        )}
        {props.aiEnabled && (
          <div className="mt-3 space-y-2">
            <input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Indicaciones opcionales (p.ej. 'el examen sale el viernes')"
              className="input text-xs"
            />
            <button
              type="button"
              className="btn w-full"
              disabled={generating}
              onClick={() =>
                startGen(async () => {
                  setAiError(null);
                  const r = await generateSuggestionsAction(props.ticketId, instructions);
                  if (r.error) setAiError(r.error);
                })
              }
            >
              {generating ? "Pensando opciones…" : latest ? "↻ Generar nuevas opciones" : "✨ Generar opciones con IA"}
            </button>
            {aiError && <p className="text-xs text-red-600">{aiError}</p>}
          </div>
        )}
      </div>

      {/* --------- Redactar --------- */}
      <form action={action} className="card space-y-3 p-4">
        <input type="hidden" name="ticket_id" value={props.ticketId} />
        <input type="hidden" name="suggestion_id" value={picked?.suggestionId ?? ""} />
        <input type="hidden" name="option_index" value={picked?.index ?? -1} />

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Responder</h2>
          <select
            className="rounded-md border px-2 py-1 text-xs"
            value=""
            onChange={(e) => {
              const t = props.templates.find((x) => x.key === e.target.value);
              if (t) {
                setSubject(t.subject);
                setBody(t.body);
                setPicked(null);
              }
            }}
          >
            <option value="">Usar plantilla…</option>
            {props.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="input" placeholder="Asunto" />
        <input name="cc" className="input" placeholder="CC (opcional, separados por coma)" />
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className="input font-mono text-xs leading-relaxed"
        />
        <input name="files" type="file" multiple className="block w-full text-xs" />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="mark_delivered" /> Marcar como entregado (detiene el correo de espera)
        </label>

        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-xs text-emerald-700">✓ Correo enviado</p>}

        <button
          className="btn-primary w-full"
          disabled={sending}
          onClick={(e) => {
            if (!confirm("¿Enviar este correo al solicitante?")) e.preventDefault();
          }}
        >
          {sending ? "Enviando…" : "Enviar respuesta"}
        </button>
      </form>
    </div>
  );
}
