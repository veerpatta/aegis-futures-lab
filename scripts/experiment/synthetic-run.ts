/** Reproducible end-to-end run of the experimental learner on SYNTHETIC prices.
 *
 *   tsx scripts/experiment/synthetic-run.ts                 # in memory, 45 trading days
 *   tsx scripts/experiment/synthetic-run.ts --days 60
 *   EXPERIMENT_E2E_BRANCH=1 DATABASE_URL=<throwaway branch> tsx scripts/experiment/synthetic-run.ts --store pg --days 12
 *
 * It opens and closes virtual trades, builds datasets, registers and trains
 * challengers, records walk-forward verdicts, and prints a report. With
 * --store pg it also proves the database guards (write-once, append-only,
 * pointer switches need a change row, at most three challengers a week).
 *
 * The pg mode REFUSES the production endpoint: run it only against a
 * throwaway Neon branch. Synthetic outcomes prove software behaviour, never a
 * market edge. */
import { createCampaign, runJob } from "@/lib/experiment/jobs";
import { MemoryStore } from "@/lib/experiment/store-memory";
import { PgStore, experimentPool } from "@/lib/experiment/store-pg";
import type { ExperimentStore } from "@/lib/experiment/store";
import { nyTimeToUnix } from "@/lib/time/ny";

const PRODUCTION_ENDPOINT = "ep-twilight-recipe-b3apaham";
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < n; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const storeKind = arg("store", "memory");
  const days = Number(arg("days", "45"));
  const start = arg("start", "2026-03-02");
  const lineage = arg("lineage", `synthetic-${Date.now().toString(36)}`);
  let store: ExperimentStore;
  if (storeKind === "pg") {
    const url = process.env.DATABASE_URL ?? "";
    if (!url || url.includes(PRODUCTION_ENDPOINT) || process.env.EXPERIMENT_E2E_BRANCH !== "1")
      throw new Error("Refusing: --store pg needs EXPERIMENT_E2E_BRANCH=1 and a DATABASE_URL for a throwaway branch (never production).");
    store = new PgStore(experimentPool(url));
  } else store = new MemoryStore();

  const at = (d: string, minutes: number) => nyTimeToUnix(d, minutes);
  const exp = await createCampaign(store, { lineage, campaign: 1, mode: "synthetic", startedAt: at(start, 60), reason: "reproducible synthetic proof of the loop" });
  const tally: Record<string, number> = {};
  let n = 0;
  for (const d of tradingDays(start, days)) {
    for (let m = 120; m <= 930; m += 30) {
      const r = await runJob({ job: "tick", invocationId: `syn-${n++}`, trigger: "test", store, lineage, nowSec: at(d, m) });
      tally[r.status] = (tally[r.status] ?? 0) + 1;
      if (r.status === "error") throw new Error(`tick failed on ${d}: ${r.message}`);
    }
    await runJob({ job: "learn", invocationId: `syn-learn-${d}`, trigger: "test", store, lineage, nowSec: at(d, 20 * 60) });
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 5) {
      const r = await runJob({ job: "review", invocationId: `syn-review-${d}`, trigger: "test", store, lineage, nowSec: at(d, 22 * 60) });
      console.log(`review ${d}: ${r.message} ${JSON.stringify(r.counts.verdicts ?? {})} registered=${JSON.stringify(r.counts.registered ?? [])}`);
    }
  }

  if (storeKind === "pg") {
    const pool = experimentPool();
    const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
    const report = (await q(`SELECT
      (SELECT count(*) FROM experiment_decisions WHERE experiment_id=$1) decisions,
      (SELECT count(*) FROM experiment_decisions WHERE experiment_id=$1 AND action='take') taken,
      (SELECT count(*) FROM experiment_positions WHERE experiment_id=$1 AND status='closed') closed,
      (SELECT coalesce(sum(net),0) FROM experiment_positions WHERE experiment_id=$1 AND status='closed') net,
      (SELECT equity FROM experiment_account WHERE experiment_id=$1) equity,
      (SELECT count(*) FROM experiment_model_versions WHERE experiment_id=$1 AND kind='logit') challengers,
      (SELECT count(*) FROM experiment_evaluations WHERE experiment_id=$1) evaluations,
      (SELECT string_agg(DISTINCT verdict, ',') FROM experiment_evaluations WHERE experiment_id=$1 AND kind='walk_forward') verdicts`, [exp.id])).rows[0];
    console.log("database report", report);
    const mustFail = async (label: string, sql: string, p: unknown[] = []) => {
      try {
        await q(sql, p);
        throw new Error(`GUARD MISSING: ${label} succeeded`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("GUARD MISSING")) throw err;
        console.log(`guard ok — ${label}: ${msg}`);
      }
    };
    await mustFail("edit a decision", "UPDATE experiment_decisions SET reason='taken' WHERE experiment_id=$1", [exp.id]);
    await mustFail("delete a decision", "DELETE FROM experiment_decisions WHERE experiment_id=$1", [exp.id]);
    await mustFail("rewrite a closed trade", "UPDATE experiment_positions SET net=999 WHERE experiment_id=$1 AND status='closed'", [exp.id]);
    await mustFail("delete a change", "DELETE FROM experiment_changes WHERE experiment_id=$1", [exp.id]);
    await mustFail("switch model without a change",
      "UPDATE experiment_pointer SET model_version_id = (SELECT id FROM experiment_model_versions v WHERE v.experiment_id=$1 AND v.id <> experiment_pointer.model_version_id ORDER BY registered_at LIMIT 1) WHERE experiment_id=$1", [exp.id]);
    await mustFail("reopen by status without a change", "UPDATE experiments SET status='paused' WHERE id=$1", [exp.id]);
    await mustFail("edit the preregistration", "UPDATE experiments SET prereg='{}'::jsonb WHERE id=$1", [exp.id]);
    await mustFail("skip the account version", "UPDATE experiment_account SET equity=1 WHERE experiment_id=$1", [exp.id]);
    await mustFail("fourth challenger in a week", `INSERT INTO experiment_model_versions(id,experiment_id,kind,spec_hash,week_key,status)
      SELECT $1 || ':x' || g, $1, 'logit', 'x' || g, '2099-W01', 'registered' FROM generate_series(1,4) g`, [exp.id]);
    // A duplicate decision for the same idea is refused by the unique key.
    await mustFail("decide the same idea twice", `INSERT INTO experiment_decisions(decision_key,experiment_id,opportunity_key,symbol,side,session_key,seen_at,info_cutoff,decided_at,provenance,model_version_id,action,reason,qty,idea,feature_version,snapshot_hash)
      SELECT decision_key || ':dup', experiment_id, opportunity_key, symbol, side, session_key, seen_at, info_cutoff, decided_at, provenance, model_version_id, action, reason, qty, idea, feature_version, snapshot_hash
      FROM experiment_decisions WHERE experiment_id=$1 LIMIT 1`, [exp.id]);
    await pool.end();
  } else {
    const m = store as MemoryStore;
    const closed = [...m.positions.values()].filter((p) => p.status === "closed");
    console.log(JSON.stringify({
      experiment: exp.id, ticks: tally, decisions: m.decisions.size,
      taken: [...m.decisions.values()].filter((d) => d.action === "take").length,
      skipReasons: [...m.decisions.values()].reduce<Record<string, number>>((a, d) => ((a[d.reason] = (a[d.reason] ?? 0) + 1), a), {}),
      closedTrades: closed.length, netAfterCosts: Math.round(closed.reduce((a, p) => a + (p.net ?? 0), 0) * 100) / 100,
      equity: m.accounts.get(exp.id)?.equity, datasets: m.datasets.length,
      challengers: [...m.versions.values()].filter((v) => v.kind === "logit").map((v) => ({ id: v.id, status: v.status, reason: v.statusReason })),
      verdicts: m.evaluations.filter((e) => e.kind === "walk_forward").map((e) => ({ v: e.versionId, verdict: e.verdict, nOos: e.nOos, reasons: e.reasons })),
      activeModel: m.pointers.get(exp.id)?.versionId,
      note: "Synthetic prices: this proves the software loop, not any market edge.",
    }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
