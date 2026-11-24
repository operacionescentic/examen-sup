import { SENTIMENT_LABEL, STATUS_LABEL, type Sentiment, type TicketStatus } from "@/lib/types";

const STATUS_CLS: Record<TicketStatus, string> = {
  abierto: "bg-blue-100 text-blue-800",
  en_proceso: "bg-amber-100 text-amber-800",
  entregado: "bg-emerald-100 text-emerald-800",
  cerrado: "bg-slate-200 text-slate-700",
};

const SENT_CLS: Record<Sentiment, string> = {
  neutral: "bg-slate-100 text-slate-600",
  molesto: "bg-orange-100 text-orange-800",
  muy_molesto: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  if (sentiment === "neutral") return null;
  return (
    <span className={`badge ${SENT_CLS[sentiment]}`}>
      {sentiment === "muy_molesto" ? "🔴" : "🟠"} {SENTIMENT_LABEL[sentiment]}
    </span>
  );
}

export function SlaBadge({ elapsed, total, delivered }: { elapsed: number; total: number; delivered: boolean }) {
  if (delivered) return <span className="badge bg-emerald-50 text-emerald-700">✓ entregado</span>;
  const cls =
    elapsed >= total ? "bg-red-50 text-red-700" : elapsed >= total - 2 ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600";
  return (
    <span className={`badge ${cls}`}>
      {elapsed}/{total} días háb.
    </span>
  );
}
