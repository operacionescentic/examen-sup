import { notFound } from "next/navigation";
import { getTicketDetail } from "@/lib/tickets";
import { getSettings } from "@/lib/settings";
import { listTemplates, render, replySubject, templateVars } from "@/lib/templates";
import { stripQuoted } from "@/lib/mail/parse";
import { businessDaysBetween, formatDateEs, toBogotaDate, todayBogota } from "@/lib/business-days";
import { env } from "@/lib/env";
import { SentimentBadge, SlaBadge, StatusBadge } from "@/components/badges";
import { TicketActions } from "@/components/ticket-actions";
import { ReplyWorkspace } from "@/components/reply-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}

export default async function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  const { id } = await params;
  const detail = await getTicketDetail(Number(id));
  if (!detail) notFound();
  const { ticket, messages, attachments, suggestions } = detail;
  const [settings, templates] = await Promise.all([getSettings(), listTemplates()]);
  const vars = templateVars(ticket, settings);
  const elapsed = businessDaysBetween(toBogotaDate(new Date(ticket.requested_at)), todayBogota());

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <section className="space-y-4">
        <div className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Ticket #{ticket.id}</div>
              <h1 className="text-lg font-semibold">{ticket.subject || "(sin asunto)"}</h1>
              <div className="text-sm text-slate-600">
                {ticket.requester_name ? `${ticket.requester_name} · ` : ""}
                {ticket.requester_email}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} />
              <SentimentBadge sentiment={ticket.sentiment} />
              <SlaBadge elapsed={elapsed} total={settings.sla_business_days} delivered={!!ticket.delivered_at} />
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <div>
              <dt>Solicitado</dt>
              <dd className="text-slate-800">{formatDateEs(new Date(ticket.requested_at))}</dd>
            </div>
            <div>
              <dt>Vence ({settings.sla_business_days} días háb.)</dt>
              <dd className="text-slate-800">{formatDateEs(ticket.due_date)}</dd>
            </div>
            <div>
              <dt>Correo de espera</dt>
              <dd className="text-slate-800">{ticket.wait_sent_at ? fmt(ticket.wait_sent_at) : "No enviado"}</dd>
            </div>
            <div>
              <dt>Intención</dt>
              <dd className="text-slate-800">{ticket.intent ?? "—"}</dd>
            </div>
          </dl>
          {ticket.triage && (
            <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900">
              <strong>Revisión IA del histórico:</strong> {ticket.triage.state.replace("_", " ")}
              {ticket.triage.delivery_evidence && <> · {ticket.triage.delivery_evidence}</>}
              <div className="text-violet-700">{ticket.triage.reason}</div>
            </div>
          )}
          {ticket.imported && !ticket.triaged_at && (
            <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Ticket importado del histórico, aún sin revisar. El estado mostrado es provisional.
            </p>
          )}
          {ticket.ai_summary && <p className="mt-3 rounded-md bg-slate-50 p-2 text-sm italic text-slate-600">{ticket.ai_summary}</p>}
          <div className="mt-4">
            <TicketActions ticket={ticket} aiEnabled={env.aiEnabled()} />
          </div>
        </div>

        {messages.map((m) => {
          const files = attachments.filter((a) => a.message_id === m.id);
          const clean = stripQuoted(m.text_body);
          return (
            <article
              key={m.id}
              className={`card p-4 ${m.direction === "out" ? "ml-8 border-blue-200 bg-blue-50/40" : "mr-8"}`}
            >
              <header className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  <strong className="text-slate-800">
                    {m.direction === "in" ? m.from_name ?? m.from_email : `Nosotros${m.sent_by ? ` · ${m.sent_by}` : ""}`}
                  </strong>
                  {m.direction === "in" && m.from_name && <> &lt;{m.from_email}&gt;</>}
                  {m.is_auto && <span className="badge ml-2 bg-slate-100">automático</span>}
                </span>
                <time>{fmt(m.sent_at)}</time>
              </header>
              <div className="whitespace-pre-wrap break-words text-sm">{clean || "(sin texto)"}</div>
              {clean.length < m.text_body.length - 20 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">Ver mensaje completo</summary>
                  <div className="mt-2 whitespace-pre-wrap break-words">{m.text_body}</div>
                </details>
              )}
              {files.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {files.map((a) => (
                    <li key={a.id}>
                      {!a.storage_path ? (
                        <span className="badge bg-slate-50 text-slate-400" title="Adjunto histórico: solo metadata, ver en Gmail/webmail">
                          📎 {a.filename}
                        </span>
                      ) : (
                      <a href={`/api/attachments/${a.id}`} className="badge bg-slate-100 hover:bg-slate-200" target="_blank">
                        📎 {a.filename}
                        {a.size_bytes ? ` (${Math.round(a.size_bytes / 1024)} KB)` : ""}
                      </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </section>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <ReplyWorkspace
          ticketId={ticket.id}
          defaultSubject={replySubject(ticket.subject)}
          signature={settings.signature}
          aiEnabled={env.aiEnabled()}
          suggestions={suggestions}
          templates={templates.map((t) => ({
            key: t.key,
            name: t.name,
            subject: render(t.subject, vars) || replySubject(ticket.subject),
            body: render(t.body, vars),
          }))}
        />
      </aside>
    </div>
  );
}
