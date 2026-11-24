"use client";

import { useState, useTransition } from "react";
import { syncNow } from "@/app/(app)/actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncNow();
            if (!r.ok) return setMsg(r.error);
            const inserted = r.report.reduce((n, x) => n + x.inserted, 0);
            const err = r.report.find((x) => x.error)?.error;
            setMsg(err ? `Error: ${err}` : `${inserted} correo(s) nuevo(s)`);
          })
        }
      >
        {pending ? "Sincronizando…" : "↻ Sincronizar"}
      </button>
    </div>
  );
}
