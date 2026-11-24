import { requireAgent } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { listTemplates } from "@/lib/templates";
import { db } from "@/lib/supabase/admin";
import {
  addUserAction,
  deleteTemplateAction,
  removeUserAction,
  saveSettingsAction,
  saveTemplateAction,
} from "../actions";

export const dynamic = "force-dynamic";

const VARS = "{{nombre}} {{email}} {{asunto}} {{ticket}} {{fecha_solicitud}} {{fecha_vence}} {{dias_habiles}} {{dias_transcurridos}} {{firma}}";

export default async function SettingsPage() {
  const agent = await requireAgent();
  const isAdmin = agent.role === "admin";
  const [settings, templates, { data: users }, { data: sync }] = await Promise.all([
    getSettings(),
    listTemplates(),
    db().from("allowed_users").select("*").order("email"),
    db().from("sync_state").select("*"),
  ]);

  return (
    <div className="space-y-8">
      {!isAdmin && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Solo administradores pueden modificar ajustes.</p>}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Estado de sincronización</h2>
        <table className="w-full text-sm">
          <tbody>
            {(sync ?? []).map((s) => (
              <tr key={s.mailbox} className="border-t">
                <td className="py-1 font-mono text-xs">{s.mailbox}</td>
                <td className="py-1 text-xs text-slate-500">
                  {s.last_run_at ? new Date(s.last_run_at).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "nunca"}
                </td>
                <td className="py-1 text-xs text-slate-500">UID {s.last_uid}</td>
                <td className="py-1 text-xs text-red-600">{s.last_error}</td>
              </tr>
            ))}
            {!sync?.length && (
              <tr>
                <td className="text-xs text-slate-500">Aún no se ha sincronizado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <form action={saveSettingsAction} className="card space-y-4 p-4">
        <h2 className="font-semibold">Parámetros de respuesta y SLA</h2>
        <label className="block text-sm">
          Pautas para la IA (tono, reglas, lo que se puede y no se puede prometer)
          <textarea name="response_guidelines" defaultValue={settings.response_guidelines} rows={16} className="input mt-1 font-mono text-xs" />
        </label>
        <label className="block text-sm">
          Firma
          <textarea name="signature" defaultValue={settings.signature} rows={4} className="input mt-1 font-mono text-xs" />
        </label>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            Días hábiles para correo de espera
            <input name="sla_business_days" type="number" min={1} max={60} defaultValue={settings.sla_business_days} className="input w-20" />
          </label>
          <label className="flex items-center gap-2">
            Aplicar SLA a tickets que vencen desde
            <input name="sla_start_date" type="date" defaultValue={settings.sla_start_date} className="input w-40" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="sla_auto_send" defaultChecked={settings.sla_auto_send} /> Enviar automáticamente
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="sla_skip_angry" defaultChecked={settings.sla_skip_angry} /> No enviar automático a clientes molestos
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Cambiar los días hábiles aplica a tickets nuevos; los existentes conservan su fecha de vencimiento. Los tickets
          que vencieron antes de la fecha de inicio (histórico) nunca reciben correo de espera automático.
        </p>
        <button className="btn-primary" disabled={!isAdmin}>Guardar</button>
      </form>

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Plantillas</h2>
        <p className="text-xs text-slate-500">Variables: {VARS}. La plantilla <code>espera</code> la usa el envío automático.</p>
        {[...templates, { id: 0, key: "", name: "", subject: "Re: {{asunto}}", body: "" }].map((t) => (
          <form key={t.id || "new"} action={saveTemplateAction} className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <input name="key" defaultValue={t.key} placeholder="clave (ej. entrega)" readOnly={!!t.key} className="input w-40 font-mono text-xs" />
              <input name="name" defaultValue={t.name} placeholder="Nombre" className="input" />
            </div>
            <input name="subject" defaultValue={t.subject} placeholder="Asunto" className="input" />
            <textarea name="body" defaultValue={t.body} rows={8} className="input font-mono text-xs" placeholder="Cuerpo" />
            <div className="flex gap-2">
              <button className="btn" disabled={!isAdmin}>{t.key ? "Guardar" : "Crear plantilla"}</button>
              {t.key && t.key !== "espera" && (
                <button formAction={deleteTemplateAction} className="btn text-red-600" disabled={!isAdmin}>
                  Eliminar
                </button>
              )}
            </div>
          </form>
        ))}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Usuarios con acceso</h2>
        <p className="text-xs text-slate-500">
          Además de estar aquí, el usuario debe existir en Supabase Auth (Authentication → Users → Add user).
        </p>
        <ul className="divide-y text-sm">
          {(users ?? []).map((u) => (
            <li key={u.email} className="flex items-center justify-between py-2">
              <span>
                {u.name ? `${u.name} · ` : ""}
                {u.email} <span className="badge bg-slate-100">{u.role}</span>
              </span>
              {isAdmin && u.email !== agent.email && (
                <form action={removeUserAction}>
                  <input type="hidden" name="email" value={u.email} />
                  <button className="btn text-red-600">Quitar</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <form action={addUserAction} className="flex flex-wrap gap-2">
            <input name="email" type="email" required placeholder="correo@centicsas.com.co" className="input w-64" />
            <input name="name" placeholder="Nombre" className="input w-48" />
            <select name="role" className="input w-32">
              <option value="agent">agente</option>
              <option value="admin">admin</option>
            </select>
            <button className="btn">Agregar</button>
          </form>
        )}
      </section>
    </div>
  );
}
