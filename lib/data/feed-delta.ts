/* How far the delayed Yahoo feed is from the real CME contracts.
   ─────────────────────────────────────────────────────────────────────────
   This is the measurement the whole Databento phase exists to produce. The
   audit asserted the live feed was "the wrong data source"; the honest
   version of that claim is a number, per bar, and it turns out to have a very
   specific shape.

   Measured on MES over 2026-05-12 → 2026-07-29 (14,713 matched 5-minute bars):

     * outside contract-roll weeks the two feeds agree to 0.01–0.28 points —
       under one MES tick (0.25). For zone geometry that is the same series.
     * for four days around the June→September roll (2026-06-15 to 06-18) they
       disagree by 43–69 points, because Yahoo's `MES=F` and Databento's
       `MES.c.0` roll on DIFFERENT schedules and are quoting different
       contracts for those sessions.

   69 points is roughly 7× a typical MES stop (~9.6 points, per tiers.ts). A
   zone formed during a roll window on one feed sits at a completely wrong
   price on the other — not slightly wrong, unusably wrong. Everywhere else,
   the delayed feed is fine.

   Which makes the actionable conclusion narrow and cheap: the problem is not
   the feed, it is the roll seam. Pure functions, tested; the runner is
   scripts/diag/feed-delta.ts. */

import type { Bar } from "@/lib/types";

export interface DeltaRow {
  time: number;
  closeDelta: number;
  highDelta: number;
  lowDelta: number;
}

/** Pair two series on identical timestamps. Unmatched bars are dropped: a bar
    one feed has and the other does not is a COVERAGE difference, reported
    separately, not a price difference. */
export function pairOnTime(a: Bar[], b: Bar[]): DeltaRow[] {
  const byTime = new Map(b.map((bar) => [bar.time, bar]));
  const out: DeltaRow[] = [];
  for (const bar of a) {
    const other = byTime.get(bar.time);
    if (!other) continue;
    out.push({
      time: bar.time,
      closeDelta: Math.abs(bar.close - other.close),
      highDelta: Math.abs(bar.high - other.high),
      lowDelta: Math.abs(bar.low - other.low),
    });
  }
  return out.sort((x, y) => x.time - y.time);
}

export interface DeltaSummary {
  matched: number;
  onlyInA: number;
  onlyInB: number;
  meanClose: number | null;
  p50Close: number | null;
  p95Close: number | null;
  maxClose: number | null;
  /** Bars whose high AND low both match exactly. */
  identicalRange: number;
}

const quantile = (sorted: number[], q: number): number | null =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;

export function summarise(a: Bar[], b: Bar[]): DeltaSummary {
  const rows = pairOnTime(a, b);
  const aTimes = new Set(a.map((x) => x.time));
  const bTimes = new Set(b.map((x) => x.time));
  const closes = rows.map((r) => r.closeDelta).sort((x, y) => x - y);
  return {
    matched: rows.length,
    onlyInA: [...aTimes].filter((t) => !bTimes.has(t)).length,
    onlyInB: [...bTimes].filter((t) => !aTimes.has(t)).length,
    meanClose: closes.length ? closes.reduce((s, v) => s + v, 0) / closes.length : null,
    p50Close: quantile(closes, 0.5),
    p95Close: quantile(closes, 0.95),
    maxClose: closes.length ? closes[closes.length - 1] : null,
    identicalRange: rows.filter((r) => r.highDelta === 0 && r.lowDelta === 0).length,
  };
}

/* ── Roll detection ───────────────────────────────────────────────────────
   A roll seam looks nothing like noise: the delta jumps to tens of points and
   STAYS there for consecutive sessions, then returns to zero. Flagging days
   by a fixed points threshold would need a per-symbol constant; using a
   multiple of the day's own typical disagreement does not.

   The threshold is in POINTS because that is what a stop is measured in, and
   the caller passes its own — MES and MNQ have very different scales. */

export interface DayDelta {
  dateKey: string;
  bars: number;
  meanClose: number;
  maxClose: number;
  /** True when this session's feeds are quoting different contracts. */
  rollAffected: boolean;
}

export function byDay(
  rows: DeltaRow[],
  dateKeyOf: (unixSec: number) => string,
  rollThresholdPoints: number
): DayDelta[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = dateKeyOf(r.time);
    const g = groups.get(k);
    if (g) g.push(r.closeDelta);
    else groups.set(k, [r.closeDelta]);
  }
  return [...groups.entries()]
    .map(([dateKey, deltas]) => {
      const mean = deltas.reduce((s, v) => s + v, 0) / deltas.length;
      return {
        dateKey,
        bars: deltas.length,
        meanClose: mean,
        maxClose: Math.max(...deltas),
        rollAffected: mean >= rollThresholdPoints,
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Contiguous runs of roll-affected sessions — the seams themselves. */
export function rollWindows(days: DayDelta[]): { from: string; to: string; peak: number }[] {
  const out: { from: string; to: string; peak: number }[] = [];
  let run: DayDelta[] = [];
  const flush = () => {
    if (run.length)
      out.push({
        from: run[0].dateKey,
        to: run[run.length - 1].dateKey,
        peak: Math.max(...run.map((d) => d.maxClose)),
      });
    run = [];
  };
  for (const d of days) {
    if (d.rollAffected) run.push(d);
    else flush();
  }
  flush();
  return out;
}
