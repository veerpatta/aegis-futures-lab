/* Which trade ideas the experimental learner decides on.

   The same ideas the Ideas tab shows (visibleSignals: live, not paused by the
   breaker, not built on stale bars) that actually triggered — the rule the
   trial account used, now the frozen control model v1. Each is decided once,
   when the experiment first sees it, and only if it was posted after the
   campaign started. MES and MNQ only. */

import type { SignalRow } from "@/lib/neon/client";
import { visibleSignals } from "@/lib/signals/snapshot";
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

/** New opportunities, oldest first. */
export function opportunitiesFromSignals(rows: SignalRow[], startedAtSec: number, decided: ReadonlySet<string>, nowSec: number): Opportunity[] {
  return visibleSignals(rows)
    .filter((r) => FILLED.has(r.status) && !decided.has(r.dedupe_key))
    .map(opportunityFromRow)
    .filter((o): o is Opportunity => o !== null && o.signalTs >= startedAtSec && o.seenAt <= nowSec)
    .sort((a, b) => a.signalTs - b.signalTs || a.key.localeCompare(b.key));
}
