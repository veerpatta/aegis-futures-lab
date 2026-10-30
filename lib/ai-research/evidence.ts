/* A bounded, read-only snapshot. Only explicit aggregate fields may be sent
 * to the provider; source messages, user records and raw prices never leave. */
import type { Pool } from "pg";
import { readSourceActivity } from "@/lib/engine/activity";
import type { Evidence } from "./core";

const iso = (value: unknown): string | null => {
  const ms = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const safeKey = (value: unknown): string | null => typeof value === "string" && /^[\w:.-]{1,80}$/.test(value) ? value : null;

export async function loadResearchEvidence(pool: Pool): Promise<Evidence[]> {
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    const clock = await client.query("SELECT transaction_timestamp() AS captured_at");
    const captured = iso(clock.rows[0]?.captured_at);
    if (!captured) throw new Error("Evidence snapshot time unavailable");
    const engine = await client.query(`SELECT id, ran_at, status, signals_created, message
      FROM public.engine_runs ORDER BY ran_at DESC, id DESC LIMIT 1`);
    const trials = await client.query(`SELECT id, registered_at, decided_at, status, outcome
      FROM public.research_trials WHERE status = 'complete'
      ORDER BY decided_at DESC NULLS LAST, id DESC LIMIT 10`);
    const account = await client.query(`SELECT experiment_id, campaign_status, updated_at,
      equity, data_as_of, last_ok_tick_at, model_kind FROM public.ai_research_evidence LIMIT 1`);
    const evidence: Evidence[] = [];
    const run = engine.rows[0];
    if (run && Number.isSafeInteger(Number(run.id)) && iso(run.ran_at)) {
      const activity = readSourceActivity(typeof run.message === "string" ? run.message : null);
      const state = ["ok", "error", "skipped"].includes(run.status) ? run.status : "unknown";
      evidence.push({ id: `engine-run:${run.id}`, label: `Source check ${iso(run.ran_at)}`,
        text: JSON.stringify({ snapshotAt: captured, recordedAt: iso(run.ran_at), status: state,
          mirroredSignals: num(run.signals_created), countScope: "trailing 7 days, not new ideas",
          sourceState: activity?.state ?? null, pausedStreams: (activity?.pausedStreams ?? []).map(safeKey).filter(Boolean).slice(0, 20),
          pricesAvailableThrough: activity ? { MES: iso(activity.marketAsOf.MES), MNQ: iso(activity.marketAsOf.MNQ) } : null,
          data: "delayed; simulated only" }) });
    }
    for (const row of trials.rows.slice(0, 10)) {
      if (!Number.isSafeInteger(Number(row.id)) || !iso(row.registered_at)) continue;
      const outcome = row.outcome && typeof row.outcome === "object" ? row.outcome as Record<string, unknown> : {};
      const verdict = ["beats-random", "no-edge", "insufficient-sample"].includes(String(outcome.verdict)) ? outcome.verdict : null;
      evidence.push({ id: `research-trial:${row.id}`, label: `Research trial ${row.id}`,
        text: JSON.stringify({ snapshotAt: captured, registeredAt: iso(row.registered_at), decidedAt: iso(row.decided_at),
          status: "complete", strategyId: safeKey(outcome.strategyId), verdict, judgedYears: num(outcome.judgedYears), yearsBeating: num(outcome.yearsBeating),
          note: "Historical screening; no automatic promotion or proof of profitability." }) });
    }
    const a = account.rows[0], id = safeKey(a?.experiment_id), updated = iso(a?.updated_at);
    if (a && id && updated) {
      const status = ["active", "paused", "locked", "stopped"].includes(a.campaign_status) ? a.campaign_status : "unknown";
      const kind = ["take_all", "logit"].includes(a.model_kind) ? a.model_kind : null;
      evidence.push({ id: `experiment:${id}:${updated}`, label: `Virtual learner ${id}, updated ${updated}`,
        text: JSON.stringify({ snapshotAt: captured, updatedAt: updated, status, virtualEquity: num(a.equity), modelKind: kind,
          dataAsOf: iso(a.data_as_of), lastSuccessfulTick: iso(a.last_ok_tick_at), note: "Virtual account; delayed prices; not a real-money result." }) });
    }
    await client.query("COMMIT");
    begun = false;
    return evidence;
  } catch (error) {
    if (begun) try { await client.query("ROLLBACK"); } catch { /* retain the original error */ }
    throw error;
  } finally { client.release(); }
}
