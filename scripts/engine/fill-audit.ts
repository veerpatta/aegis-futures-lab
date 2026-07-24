/* Fill-realism audit — how convincingly does the 5m bar path support the
   simulated fill? Pure function over bars already in memory; measurement
   only, never a filter, no strategy logic anywhere.

   Exact rule (LONG shown; SHORT mirrors with highs above the limit):

   limit-fill streams (tier A, resting limit at the zone proximal —
   approximated here as entry_price minus slippage, since the engine fills
   at limit + slippage when price arrives from above):
     clean    — the entry bar OR the very next bar traded THROUGH the limit
                by at least one full tick (low <= limit - tick): a resting
                order almost surely fills behind that path.
     marginal — the path reached the limit but penetrated less than a tick,
                AND some later bar within the trade's life came back to the
                level (low <= limit): a second chance to fill existed.
     doubtful — touch-only: penetration < 1 tick and the level was never
                revisited before the exit. A real fill is unlikely.

   nextOpen-fill streams (tier B, market at next bar's open): fills are
   unconditional, so classify clean whenever the fill bar is a real traded
   bar with finite OHLC, else marginal. (The feed shaping already drops
   non-finite bars, so marginal here means "fill bar missing from data".)

   Returns null when the entry bar cannot be located in the series — the
   caller leaves fill_confidence null rather than guessing. */

import type { Bar } from "@/lib/types";

export type FillConfidence = "clean" | "marginal" | "doubtful";

export const DEFAULT_TICK = 0.25;

export interface FillAuditArgs {
  fillModel: "limit" | "nextOpen";
  direction: "long" | "short";
  /** The resting-limit level being audited (limit streams). */
  limit: number;
  /** Unix seconds of the fill bar. */
  entryTime: number;
  /** Unix seconds of the exit, or null while the position is open. */
  exitTime: number | null;
  /** The symbol's full 5m series, ascending. */
  bars: Bar[];
  tick?: number;
}

/* Last index with time <= t (binary search), or -1. */
function indexAtOrBefore(bars: Bar[], t: number): number {
  let lo = 0,
    hi = bars.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function auditFill(args: FillAuditArgs): FillConfidence | null {
  const { fillModel, direction, limit, entryTime, exitTime, bars } = args;
  const tick = args.tick ?? DEFAULT_TICK;
  const idx = indexAtOrBefore(bars, entryTime);
  if (idx < 0) return null;
  const entryBar = bars[idx];

  if (fillModel === "nextOpen") {
    const finite = [entryBar.open, entryBar.high, entryBar.low, entryBar.close].every(
      Number.isFinite
    );
    return finite ? "clean" : "marginal";
  }

  // Points traded beyond the limit (0 = exact touch, negative = never reached).
  const penetration = (b: Bar) => (direction === "long" ? limit - b.low : b.high - limit);

  const end = exitTime === null ? bars.length - 1 : Math.max(idx, indexAtOrBefore(bars, exitTime));
  const nextBar = idx + 1 <= end ? bars[idx + 1] : null;

  if (penetration(entryBar) >= tick) return "clean";
  if (nextBar && penetration(nextBar) >= tick) return "clean";

  const touched = penetration(entryBar) >= 0;
  let revisited = false;
  for (let i = idx + 1; i <= end && !revisited; i++) revisited = penetration(bars[i]) >= 0;

  return touched && revisited ? "marginal" : "doubtful";
}
