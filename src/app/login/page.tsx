"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Helpdesk Exámenes</h1>
          <p className="text-sm text-slate-500">examenes@centicsas.com.co</p>
        </div>
        <label className="block text-sm">
          Correo
          <input name="email" type="email" required autoComplete="email" className="input mt-1" />
        </label>
        <label className="block text-sm">
          Contraseña
          <input name="password" type="password" required autoComplete="current-password" className="input mt-1" />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="btn-primary w-full">
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
