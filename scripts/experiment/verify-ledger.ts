/** Read-only acceptance for the virtual account. Never fabricates a trade. */
import { experimentPool } from "@/lib/experiment/store-pg";

async function main() {
  const pool = experimentPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const lineage = process.env.AEGIS_EXPERIMENT_LINEAGE ?? "learner";
    const rows = (await c.query(`SELECT e.id,e.status,e.capital,e.execution_clock,e.started_at,e.simulation_from,a.*
      FROM experiments e JOIN experiment_account a ON a.experiment_id=e.id WHERE e.lineage=$1 ORDER BY e.campaign DESC`, [lineage])).rows;
    const active = rows.filter((r) => r.status === "active" || r.status === "paused" || r.status === "locked");
    if (active.length !== 1) throw new Error(`Expected one current account, found ${active.length}`);
    const a = active[0];
    if (a.execution_clock !== "delayed_market") throw new Error("Delayed-market account is not active");
    const totals = (await c.query(`SELECT count(*)::int positions,
      count(*) FILTER(WHERE status='closed')::int closed,
      count(*) FILTER(WHERE status='open')::int open,
      count(*) FILTER(WHERE status='pending_fill')::int pending,
      coalesce(sum(net) FILTER(WHERE status='closed'),0)::float8 realized,
      count(*) FILTER(WHERE fill_ts IS NOT NULL AND fill_ts<decided_at)::int early_fills,
      count(*) FILTER(WHERE risk>100.001 AND status<>'cancelled')::int over_risk
      FROM experiment_positions WHERE experiment_id=$1`, [a.id])).rows[0];
    const fills = (await c.query(`SELECT count(*)::int fills,count(*) FILTER(WHERE kind='entry')::int entries,
      count(*) FILTER(WHERE kind='exit')::int exits FROM experiment_fills WHERE experiment_id=$1`, [a.id])).rows[0];
    const evidence = (await c.query(`SELECT count(*)::int decisions,
      count(*) FILTER(WHERE provenance<>'replay')::int non_replay,
      count(*) FILTER(WHERE observed_at IS NULL)::int missing_receipts FROM experiment_decisions WHERE experiment_id=$1`, [a.id])).rows[0];
    const earlier = (await c.query(`SELECT count(*)::int n FROM experiment_decisions d JOIN experiments e ON e.id=d.experiment_id
      WHERE e.lineage=$1 AND e.id<>$2`, [lineage, a.id])).rows[0].n;
    const close = (x: unknown, y: number) => Math.abs(Number(x) - y) < 0.011;
    if (!close(a.realized, totals.realized) || !close(a.equity, Number(a.capital) + Number(a.realized) + Number(a.unrealized)))
      throw new Error("Account and trade ledger do not balance");
    if (totals.early_fills || totals.over_risk || evidence.non_replay || evidence.missing_receipts || Number(a.open_risk)>200.001)
      throw new Error("Execution, risk or provenance acceptance failed");
    if (fills.exits !== totals.closed || fills.entries !== totals.closed + totals.open)
      throw new Error("Entry and exit ledger does not match positions");
    if (process.argv.includes("--require-filled") && !fills.entries) throw new Error("No actual virtual fill has been recorded");
    if (process.argv.includes("--caught-up") && Number(a.backlog_count)) throw new Error("The account still has a backlog");
    console.log(JSON.stringify({ account: a.id, equity: Number(a.equity), realized: Number(a.realized), dataAsOf: a.data_as_of,
      backlog: Number(a.backlog_count), earlierAttempts: earlier, ...totals, ...fills, ...evidence, balanced: true }, null, 2));
    await c.query("ROLLBACK");
  } finally { c.release(); await pool.end(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "Ledger verification failed"); process.exitCode = 1; });
