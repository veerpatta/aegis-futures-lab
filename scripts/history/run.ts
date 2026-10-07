/** Run one stage of the historical study (lib/history/jobs.ts).
 *
 *   tsx scripts/history/run.ts register
 *   tsx scripts/history/run.ts replay [--max-chunks 2] [--minutes 5]
 *   tsx scripts/history/run.ts study
 *   tsx scripts/history/run.ts shadow
 *
 * Runs in GitHub Actions (.github/workflows/historical-study.yml) on a free
 * standard runner — research measurements belong in CI, not on a laptop.
 * Read-only on bars_5m and every legacy table; writes only history_* and, in
 * the shadow stage, one shadow model version through the experiment's own
 * guarded importer. Virtual only: no broker, no paid data, no paid AI. */
import { experimentPool, PgStore } from "@/lib/experiment/store-pg";
import { importShadowCandidate } from "@/lib/experiment/jobs";
import { researchCodeHash } from "@/scripts/engine/research-code";
import { PgHistoryStore } from "@/lib/history/store-pg";
import { runStage } from "@/lib/history/jobs";
import type { HistStage } from "@/lib/history/store";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const stage = process.argv[2] as HistStage;
  if (!["register", "replay", "study", "shadow"].includes(stage)) throw new Error("usage: run.ts <register|replay|study|shadow>");
  const pool = experimentPool();
  const store = new PgHistoryStore(pool);
  const invocationId = process.env.GITHUB_RUN_ID ? `gh:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT ?? 1}` : `manual:${Date.now()}`;
  const started = Date.now();
  const result = await runStage({
    store, stage, invocationId, codeSha: process.env.GITHUB_SHA ?? null, researchCodeHash: researchCodeHash(),
    maxChunks: arg("max-chunks") ? Number(arg("max-chunks")) : undefined,
    jobMinutes: arg("minutes") ? Number(arg("minutes")) : undefined,
    importShadow: (c) => importShadowCandidate(new PgStore(pool), {
      lineage: process.env.AEGIS_EXPERIMENT_LINEAGE ?? "learner", artifact: c.artifact, spec: c.spec,
      origin: c.origin as never, invocationId,
    }),
  });
  const mem = process.memoryUsage();
  console.log(JSON.stringify({ ...result, wallMs: Date.now() - started, rssMB: Math.round(mem.rss / 1e6), heapMB: Math.round(mem.heapUsed / 1e6) }, null, 2));
  await pool.end();
  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
