/** Fallback runner for the experimental learner: the same runJob the Neon
 * Function calls, started from GitHub Actions (.github/workflows/experiment-fallback.yml)
 * or by hand. Usage: tsx scripts/experiment/run.ts <tick|learn|review> [--if-stale]
 *
 * --if-stale exits quietly when the Neon schedule produced an ok tick in the
 * last 40 minutes, so a fallback schedule never doubles the work (and if it
 * does, the run key, the lock and the unique decision keys make it harmless).
 * Virtual only — no broker, no real money, no paid API. */
import { runJob } from "@/lib/experiment/jobs";
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";
import type { JobName } from "@/lib/experiment/store";

async function main() {
  const job = process.argv[2] as JobName;
  if (!["tick", "learn", "review"].includes(job)) throw new Error("usage: run.ts <tick|learn|review> [--if-stale]");
  const lineage = process.env.AEGIS_EXPERIMENT_LINEAGE ?? "learner";
  const pool = experimentPool();
  if (process.argv.includes("--if-stale")) {
    const r = await pool.query(
      `SELECT max(r.finished_at) AS t FROM experiment_runs r JOIN experiments e ON e.id = r.experiment_id
       WHERE e.lineage=$1 AND r.job=$2 AND r.status IN ('ok','skipped') AND r.trigger='neon'`, [lineage, job]);
    const last = r.rows[0]?.t ? Date.parse(r.rows[0].t) : 0;
    const freshFor = job === "tick" ? 40 * 60_000 : job === "learn" ? 26 * 3600_000 : 8 * 86400_000;
    if (Date.now() - last < freshFor) {
      console.log(`Neon ran ${job} ${Math.round((Date.now() - last) / 60_000)} min ago; fallback not needed.`);
      await pool.end();
      return;
    }
  }
  const runId = process.env.GITHUB_RUN_ID ? `gh:${job}:${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT ?? 1}` : `manual:${job}:${Date.now()}`;
  const result = await runJob({
    job, invocationId: runId, trigger: process.env.GITHUB_RUN_ID ? "github" : "manual", store: new PgStore(pool), lineage,
    codeSha: process.env.GITHUB_SHA ?? null,
  });
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
