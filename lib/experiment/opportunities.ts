/* Which trade ideas the experimental learner decides on.

   v1/v2 campaigns: the same ideas the Ideas tab shows (visibleSignals: live,
   not paused by the breaker, not built on stale bars) that actually triggered
   — the rule the trial account used, now the frozen control model v1.
   v3 campaigns (rules.ideas = "all-filled"): every live, filled idea that is
   not built on stale bars, INCLUDING ideas from a method its loss guard has
   paused, each marked `sourcePaused`. Under v2 a fully paused source left the
   learner with nothing to decide (16-30 October 2026).
   Each is decided once, when the experiment first sees it, and only if it was
   posted after the campaign started. MES and MNQ only. */

import type { SignalRow } from "@/lib/neon/client";
import { visibleSignals } from "@/lib/signals/snapshot";
import { liveOnly } from "@/lib/signals/live";
import { realStrategyLabel } from "@/scripts/engine/train-set";
import type { Opportunity } from "./types";

/* "pending" still waits for its entry and "cancelled" never filled. */
export const FILLED = new Set(["triggered", "hit_target", "hit_stop", "closed_win", "expired"]);
const BAR_SEC = 300;
const sec = (iso: string | null | undefined) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);

export function opportunityFromRow(row: SignalRow): Opportunity | null {
  if (row.symbol !== "MES" && row.symbol !== "MNQ") return null;
  const entry = Number(row.entry_price), stop = Number(row.stop_price);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry === stop) return null;
  const signalTs = sec(row.signal_ts)!;
  const created = sec((row as SignalRow & { created_at?: string }).created_at) ?? signalTs + BAR_SEC;
  const target = row.target_price == null ? null : Number(row.target_price);
  return {
    key: row.dedupe_key, signalId: row.id ?? null, symbol: row.symbol, side: row.direction === "long" ? "LONG" : "SHORT",
    entry, stop, target: target !== null && Number.isFinite(target) ? target : null,
    signalTs, seenAt: Math.max(created, signalTs + BAR_SEC), exitTs: sec(row.exit_ts),
    strategy: realStrategyLabel(row.dedupe_key), tier: row.tier ?? null, regime: row.regime ?? null, vixBucket: row.vix_bucket ?? null,
    score: row.score == null ? null : Number(row.score), rr: row.rr == null ? null : Number(row.rr),
  };
}

/** Every idea a source pass may publish for the learner: live, not built on stale
    bars, paused or not. Each campaign then applies its own rule (above). */
export function publishableSignals(rows: SignalRow[]): SignalRow[] {
  return liveOnly(rows).filter((r) => !r.stale_data);
}

/** New opportunities, oldest first. `includePaused` is the v3 rule. */
export function opportunitiesFromSignals(
  rows: SignalRow[], startedAtSec: number, decided: ReadonlySet<string>, nowSec: number, opts: { includePaused?: boolean } = {},
): Opportunity[] {
  const pool = opts.includePaused ? publishableSignals(rows) : visibleSignals(rows);
  return pool
    .filter((r) => FILLED.has(r.status) && !decided.has(r.dedupe_key))
    .map((r) => {
      const o = opportunityFromRow(r);
      // Only v3 records the flag, so earlier campaigns' stored ideas keep their exact shape.
      return o && opts.includePaused ? { ...o, sourcePaused: r.suppressed === true } : o;
    })
    .filter((o): o is Opportunity => o !== null && o.signalTs >= startedAtSec && o.seenAt <= nowSec)
    .sort((a, b) => a.signalTs - b.signalTs || a.key.localeCompare(b.key));
}
