/* Rows the engine can no longer reach.

   run-live.ts recomputes 60 days but only rewrites signal rows from the last
   seven (LOOKBACK_DAYS). A row is closed by that rewrite: a later pass emits the
   same dedupe_key with its exit and the upsert overwrites the open state. So a
   row that is still `triggered` or `pending` once it falls behind the cutoff
   has only one explanation — the recompute stopped producing that trade while
   it was inside the window (a revised Yahoo bar removed the trigger), and the
   orphan sweep, which also only looks inside the window, never saw it.

   Two rows were stranded that way on 2026-08-18 (B:rsi-reversion:MES and MNQ,
   1787033700): every run from Aug 18 to Aug 25 warned "no longer match a
   computed trade", orphan marking shipped on Aug 25 as they aged out, and the
   app showed the MNQ one as OPEN for seven weeks.

   The plan below is pure so it can be tested with those exact keys. It keeps
   one safety net: if the full recompute still holds a CLOSED trade under the
   key (possible after an engine outage longer than the mirror window), the row
   takes that recorded outcome instead of being written off. */

export interface StaleOpenRow {
  dedupe_key: string;
  status: string;
  signal_ts: string;
}

export interface ComputedOutcome {
  status: string;
  exit_ts: string | null;
  exit_price: number | null;
  pnl_usd: number | null;
}

export interface StaleOpenPlan {
  /** Still in the recompute as a finished trade: write its recorded outcome. */
  close: { key: string; outcome: ComputedOutcome }[];
  /** Not in the recompute any more: mark orphaned (never deleted). */
  orphan: string[];
}

const OPEN_STATUSES = new Set(["triggered", "pending"]);
const FINISHED = new Set(["hit_target", "hit_stop", "closed_win", "expired"]);

export function planStaleOpen(
  rows: StaleOpenRow[],
  cutoffSec: number,
  computed: ReadonlyMap<string, ComputedOutcome>
): StaleOpenPlan {
  const plan: StaleOpenPlan = { close: [], orphan: [] };
  for (const row of rows) {
    if (!OPEN_STATUSES.has(row.status)) continue;
    if (Date.parse(row.signal_ts) / 1000 >= cutoffSec) continue; // the normal upsert owns it
    const outcome = computed.get(row.dedupe_key);
    if (outcome && FINISHED.has(outcome.status) && outcome.exit_ts !== null) {
      plan.close.push({ key: row.dedupe_key, outcome });
    } else {
      plan.orphan.push(row.dedupe_key);
    }
  }
  return plan;
}
