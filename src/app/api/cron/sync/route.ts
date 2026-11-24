import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkBearer } from "@/lib/secret";
import { withJobLock } from "@/lib/lock";
import { syncAll } from "@/lib/mail/sync";
import { classifyPending, triagePending } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Llamado por el cron de cPanel cada 5 minutos:
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sync
 */
async function handle(req: Request) {
  if (!checkBearer(req, env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await withJobLock("sync", 120, async () => {
    const mail = await syncAll({ budgetMs: 30_000, maxPerMailbox: 100 });
    if (!env.aiEnabled()) return { mail, ai: { skipped: "AI_PROVIDER=none: el trabajo de IA lo hace Claude Code vía MCP" } };
    const ai = await classifyPending(started + 50_000);
    // Tickets históricos pendientes de revisión (la importación masiva se hace con scripts/backfill.ts)
    const triage = await triagePending(started + 55_000, 3);
    return { mail, ai, triage };
  });
  if (!result) return NextResponse.json({ ok: true, skipped: "otra sincronización en curso" });
  return NextResponse.json({ ok: true, ms: Date.now() - started, ...result });
}

export { handle as GET, handle as POST };
