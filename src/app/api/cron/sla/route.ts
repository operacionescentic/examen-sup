import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { checkBearer } from "@/lib/secret";
import { withJobLock } from "@/lib/lock";
import { runSla } from "@/lib/sla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Llamado por el cron de cPanel una vez al día (p.ej. 8:00 a.m. lunes a viernes):
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sla
 */
async function handle(req: Request) {
  if (!checkBearer(req, env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await withJobLock("sla", 300, runSla);
  if (!report) return NextResponse.json({ ok: true, skipped: "SLA en curso" });
  return NextResponse.json({ ok: true, ...report });
}

export { handle as GET, handle as POST };
