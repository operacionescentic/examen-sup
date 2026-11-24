"use client";

import { useState, useTransition } from "react";
import { markAttendedAction, sendWaitNowAction, setStatusAction, triageAction } from "@/app/(app)/actions";
import type { Ticket } from "@/lib/types";

export function TicketActions({ ticket, aiEnabled }: { ticket: Ticket; aiEnabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setMsg(null);
      try {
        const r = (await fn()) as { error?: string } | undefined;
        if (r?.error) setMsg(r.error);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error");
      }
    });
  const active = ticket.status === "abierto" || ticket.status === "en_proceso";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active && (
        <button className="btn" disabled={pending} onClick={() => run(() => setStatusAction(ticket.id, "entregado"))}>
          ✓ Marcar entregado
        </button>
      )}
      {ticket.status !== "cerrado" && (
        <button className="btn" disabled={pending} onClick={() => run(() => setStatusAction(ticket.id, "cerrado"))}>
          Cerrar
        </button>
      )}
      {!active && (
        <button className="btn" disabled={pending} onClick={() => run(() => setStatusAction(ticket.id, "en_proceso"))}>
          Reabrir
        </button>
      )}
      {ticket.needs_attention && (
        <button className="btn" disabled={pending} onClick={() => run(() => markAttendedAction(ticket.id))}>
          Marcar atendido
        </button>
      )}
      {active && !ticket.wait_sent_at && !ticket.delivered_at && (
        <button
          className="btn"
          disabled={pending}
          onClick={() => {
            if (confirm("¿Enviar ahora el correo de espera a este solicitante?")) run(() => sendWaitNowAction(ticket.id));
          }}
        >
          ⏳ Enviar correo de espera
        </button>
      )}
      {aiEnabled && (
        <button
          className="btn"
          disabled={pending}
          title="La IA lee el hilo y determina si está entregado, pendiente o en espera"
          onClick={() => run(() => triageAction(ticket.id))}
        >
          🔍 Revisar estado con IA
        </button>
      )}
      {pending && <span className="text-xs text-slate-400">Procesando…</span>}
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
