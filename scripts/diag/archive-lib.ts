/* Shared helpers for the 2026-07-26 weekly research pass — archive loading,
   session enumeration, formatting, and a bootstrap drawdown estimator. Not a
   diagnostic itself; imported by management-replay.ts, time-of-day-expectancy.ts
   and cost-sensitivity.ts so the three scripts read the archive identically
   (same day-alignment fix as scripts/diag/tier-a-baseline.ts). Read-only. */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { alignArchiveSlice } from "@/lib/data/window";
import { nyMeta } from "@/lib/time/ny";
import type { FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { parseBarSource } from "@/lib/data/source";
import { fetchArchiveBars } from "@/lib/data/archive";

/* Defaults to yahoo so the 2026-07-26 research pass's recorded numbers keep
   reproducing; BAR_SOURCE=databento re-runs the same three diagnostics over
   seven years of real contracts instead of sixty days of a delayed proxy. */
const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);

export const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

export async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  return alignArchiveSlice(await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE }));
}

/** Trading sessions in a series: NY weekdays with at least one RTH bar. */
export function sessionsIn(bars: Bar[]): string[] {
  const days = new Set<string>();
  for (const b of bars) {
    const m = nyMeta(b.time);
    if (m.weekday !== "Sat" && m.weekday !== "Sun" && m.minutes >= 570 && m.minutes < 925)
      days.add(m.dateKey);
  }
  return [...days].sort();
}

/** Mean-of-true-range ATR (not Wilder-smoothed — good enough for a diagnostic
    trailing-stop sweep, not a claim about what any strategy uses internally). */
export function atrAt(bars: Bar[], i: number, len = 14): number {
  const from = Math.max(1, i - len + 1);
  let sum = 0,
    n = 0;
  for (let k = from; k <= i; k++) {
    const b = bars[k],
      p = bars[k - 1];
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    sum += tr;
    n++;
  }
  return n ? sum / n : 0;
}

export const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "∞");

export function pctile(vals: number[], p: number): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[idx];
}

/* Path-dependence means the single realized max-drawdown understates risk —
   the same trades in a different order can draw down much further. Shuffle
   trade order `iterations` times and report the 95th percentile of the
   resulting max drawdowns, not just the one order that happened. */
export function p95Drawdown(pnls: number[], iterations = 500): number {
  if (!pnls.length) return 0;
  const dds: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const arr = [...pnls];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    let equity = 0,
      peak = 0,
      dd = 0;
    for (const pnl of arr) {
      equity += pnl;
      peak = Math.max(peak, equity);
      dd = Math.max(dd, peak - equity);
    }
    dds.push(dd);
  }
  return pctile(dds, 0.95);
}

export function profitFactor(pnls: number[]): number {
  const gw = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const gl = Math.abs(pnls.filter((p) => p < 0).reduce((s, p) => s + p, 0));
  return gl ? gw / gl : gw ? Infinity : 0;
}

export function winRate(pnls: number[]): number {
  return pnls.length ? (100 * pnls.filter((p) => p > 0).length) / pnls.length : 0;
}
