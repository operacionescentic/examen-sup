/**
 * Importación completa del histórico + revisión IA.
 *
 *   npm run backfill               # sincroniza todo y luego hace triage
 *   npm run backfill -- --sync     # solo descarga correos
 *   npm run backfill -- --triage   # solo triage de tickets importados
 *
 * Corre en su computador (sin límite de tiempo de Vercel). Se puede interrumpir y
 * volver a lanzar: retoma desde el último UID guardado y no duplica mensajes.
 */
import { syncAll, relinkOrphans } from "@/lib/mail/sync";
import { triagePending } from "@/lib/ai";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";

const args = process.argv.slice(2);
const onlySync = args.includes("--sync");
const onlyTriage = args.includes("--triage");
const CONCURRENCY = Number(process.env.TRIAGE_CONCURRENCY ?? 4);

async function main() {
  const settings = await getSettings();
  console.log(`SLA activo para vencimientos desde ${settings.sla_start_date}. Envío automático: ${settings.sla_auto_send}`);

  if (!onlyTriage) {
    console.log("== Descargando correos ==");
    for (let round = 1; ; round++) {
      const reports = await syncAll({
        budgetMs: 10 * 60_000,
        maxPerMailbox: 500,
        onProgress: (r) =>
          process.stdout.write(
            `\r  [${r.source}] leídos ${r.fetched} · nuevos ${r.inserted} · tickets nuevos ${r.newTickets} · faltan ${r.remaining}      `,
          ),
      });
      process.stdout.write("\n");
      for (const r of reports) {
        console.log(`  ronda ${round} · ${r.source}: +${r.inserted} mensajes, +${r.newTickets} tickets, faltan ${r.remaining}${r.error ? ` · ERROR ${r.error}` : ""}`);
      }
      const errors = reports.filter((r) => r.error);
      if (errors.length) {
        console.error("Hubo errores; corrija y vuelva a ejecutar (retoma donde quedó).");
        process.exit(1);
      }
      if (reports.every((r) => r.remaining <= 0)) break;
    }
    const linked = await relinkOrphans(settings.sla_business_days, 5000);
    console.log(`  respuestas huérfanas re-enlazadas: ${linked}`);
  }

  if (!onlySync) {
    if (!env.aiEnabled()) {
      console.log("AI_PROVIDER=none: se omite el triage aquí. Abra Claude Code en este repo y ejecute /triage (usa el MCP)."); 
      process.exit(0);
    }
    console.log(`== Triage IA (concurrencia ${CONCURRENCY}) ==`);
    for (;;) {
      const r = await triagePending(Date.now() + 10 * 60_000, 50, CONCURRENCY);
      console.log(`  revisados ${r.triaged} · errores ${r.errors} · faltan ${r.remaining}`);
      if (r.remaining <= 0 || (r.triaged === 0 && r.errors > 0)) break;
    }
  }
  console.log("Listo.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
