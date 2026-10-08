/** Publish a completed signal-engine pass. No market fetch, only snapshots.
 * The workflow serializes producer passes through the end of this step. */
import { experimentPool } from "@/lib/experiment/store-pg";
import { visibleSignals } from "@/lib/signals/snapshot";
import { FILLED } from "@/lib/experiment/opportunities";
import type { SignalRow } from "@/lib/neon/client";

async function main() {
  const pool = experimentPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('aegis-exp:publish',0))");
    const run = (await c.query("SELECT id,status,message FROM engine_runs ORDER BY ran_at DESC,id DESC LIMIT 1")).rows[0];
    if (!run || run.status !== "ok") throw new Error("The latest signal-engine pass has not completed successfully.");
    if (/\b(MES|MNQ) archive write failed/.test(run.message ?? "")) throw new Error("Required market bars were not archived.");
    const id = `engine:${run.id}`;
    const ends = (await c.query("SELECT symbol,max(time)+300 AS t FROM bars_5m WHERE source='yahoo' AND symbol IN ('MES','MNQ') AND time+300<=extract(epoch FROM now()) GROUP BY symbol")).rows;
    if (ends.length !== 2) throw new Error("Both market archives are required.");
    const watermarks = Object.fromEntries(ends.map((r) => [r.symbol, Number(r.t)]));
    const inserted = await c.query("INSERT INTO experiment_source_batches(id,watermarks,source_sha) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
      [id, JSON.stringify(watermarks), process.env.GITHUB_SHA ?? process.env.AEGIS_CODE_SHA ?? null]);
    let ideas = 0;
    if (inserted.rowCount) {
      const rows = (await c.query("SELECT * FROM signals WHERE signal_ts >= now()-interval '8 days' ORDER BY signal_ts,id")).rows as SignalRow[];
      for (const row of visibleSignals(rows)) {
        if ((row.symbol !== "MES" && row.symbol !== "MNQ") || !FILLED.has(row.status)) continue;
        // Keep setup inputs only. Source exits and P&L are never decision inputs.
        const snapshot = { ...row, exit_ts: null, exit_price: null, pnl_usd: null, status: "triggered" };
        const r = await c.query("INSERT INTO experiment_source_ideas(opportunity_key,batch_id,signal_ts,signal_row) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [row.dedupe_key, id, row.signal_ts, JSON.stringify(snapshot)]);
        ideas += r.rowCount ?? 0;
      }
    }
    await c.query("COMMIT");
    console.log(JSON.stringify({ batch: id, newIdeas: ideas, watermarks, duplicate: !inserted.rowCount }));
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); await pool.end(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "Publication failed"); process.exitCode = 1; });
