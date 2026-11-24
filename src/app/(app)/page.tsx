import Link from "next/link";
import { countByFilter, FILTERS, listTickets, type FilterKey } from "@/lib/tickets";
import { getSettings } from "@/lib/settings";
import { businessDaysBetween, toBogotaDate, todayBogota } from "@/lib/business-days";
import { SentimentBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { SyncButton } from "@/components/sync-button";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 50;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function Inbox({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const filter = (typeof sp.f === "string" && sp.f in FILTERS ? sp.f : "atencion") as FilterKey;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.p) || 1);

  const [{ tickets, count }, counts, settings] = await Promise.all([
    listTickets({ filter, q, limit: PAGE, offset: (page - 1) * PAGE }),
    countByFilter(),
    getSettings(),
  ]);
  const today = todayBogota();
  const href = (p: Record<string, string | number>) =>
    "/?" + new URLSearchParams({ f: filter, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <aside className="space-y-1">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
          <Link
            key={k}
            href={`/?f=${k}`}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
              k === filter ? "bg-slate-900 text-white" : "hover:bg-white"
            }`}
          >
            <span>{FILTERS[k]}</span>
            <span className={k === filter ? "text-slate-300" : "text-slate-400"}>{counts[k]}</span>
          </Link>
        ))}
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex flex-1 gap-2">
            <input type="hidden" name="f" value={filter} />
            <input name="q" defaultValue={q} placeholder="Buscar por email, nombre, asunto, contenido o #ticket" className="input" />
            <button className="btn">Buscar</button>
          </form>
          <SyncButton />
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Solicitante / asunto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">SLA</th>
                <th className="px-3 py-2">Último</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tickets.map((t) => {
                const elapsed = businessDaysBetween(toBogotaDate(new Date(t.requested_at)), today);
                return (
                  <tr key={t.id} className={`hover:bg-slate-50 ${t.needs_attention ? "font-medium" : "text-slate-600"}`}>
                    <td className="px-3 py-2 text-slate-400">
                      <Link href={`/tickets/${t.id}`}>{t.id}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/tickets/${t.id}`} className="block">
                        <div className="flex items-center gap-2">
                          {t.needs_attention && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                          <span>{t.requester_name ?? t.requester_email}</span>
                          <SentimentBadge sentiment={t.sentiment} />
                        </div>
                        <div className="truncate text-xs text-slate-500">{t.subject || "(sin asunto)"}</div>
                        {t.ai_summary && <div className="truncate text-xs italic text-slate-400">{t.ai_summary}</div>}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                      {t.wait_sent_at && <div className="mt-1 text-xs text-slate-400">espera enviada</div>}
                    </td>
                    <td className="px-3 py-2">
                      <SlaBadge elapsed={elapsed} total={settings.sla_business_days} delivered={!!t.delivered_at} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDate(t.last_message_at)}</td>
                  </tr>
                );
              })}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                    Sin tickets en esta vista
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {count > PAGE && (
          <div className="flex items-center justify-end gap-2 text-sm">
            {page > 1 && <Link className="btn" href={href({ p: page - 1 })}>← Anterior</Link>}
            <span className="text-slate-500">
              Página {page} de {Math.ceil(count / PAGE)}
            </span>
            {page * PAGE < count && <Link className="btn" href={href({ p: page + 1 })}>Siguiente →</Link>}
          </div>
        )}
      </section>
    </div>
  );
}
