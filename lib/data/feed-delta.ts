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

/* ── Intrinsic seam detection: one series, no second feed ─────────────────
   Everything above needs TWO feeds to compare, so it can only see the 68
   sessions where Yahoo and Databento overlap. The seven-year Databento
   archive has roughly 29 quarterly rolls in it and no second feed to check
   them against, and that matters for a specific reason stated in the backfill
   commit: a continuous contract's roll is a PRICE DISCONTINUITY, and a
   discontinuity is exactly the wide-range "departure" candle a zone engine is
   built to trade. Some fraction of a zone strategy's seven-year trades are
   therefore chasing an artefact of contract stitching rather than a market
   event.

   A seam is detectable from one series alone: the session opens a long way
   from where the previous session closed, relative to how far this market
   normally travels. Scaling by the trailing mean session range rather than a
   fixed point threshold is what makes one function work for both MES (~9 pt
   ATR) and MNQ (~57 pt ATR).

   This flags overnight GAPS, which is a superset of rolls — a genuine
   gap-up on news trips it too. That is the right way round for the use it is
   put to: excluding a handful of real gap sessions costs a little data,
   whereas leaving the roll discontinuities in silently inflates whatever a
   zone engine reports. The caller is told the count so it can see the cost. */

export interface SessionGap {
  dateKey: string;
  /** |first open − previous close|, in points. */
  gapPoints: number;
  /** The trailing mean session range the gap is measured against. */
  refRange: number;
  /** gapPoints / refRange. */
  ratio: number;
  seam: boolean;
}

/** How many multiples of the trailing session range an overnight gap must
    exceed to be called a seam. 1.5 is deliberately loose: the measured MES
    roll seam is 71.5 points against a mean session range of ~35, and the MNQ
    one is 397.5 against ~180, so both clear it with room, while ordinary
    overnight drift does not come close. */
export const SEAM_GAP_RATIO = 1.5;

/** Sessions per the caller's date key, oldest first, with their open, close
    and range. Exported because the seam scan and its tests both want it. */
export function sessionBounds(
  bars: Bar[],
  dateKeyOf: (unixSec: number) => string
): { dateKey: string; open: number; close: number; range: number }[] {
  const groups = new Map<string, Bar[]>();
  for (const b of bars) {
    const k = dateKeyOf(b.time);
    const g = groups.get(k);
    if (g) g.push(b);
    else groups.set(k, [b]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, bs]) => {
      const sorted = [...bs].sort((a, b) => a.time - b.time);
      return {
        dateKey,
        open: sorted[0].open,
        close: sorted[sorted.length - 1].close,
        range: Math.max(...sorted.map((b) => b.high)) - Math.min(...sorted.map((b) => b.low)),
      };
    });
}

/** Sessions whose opening gap marks a probable contract-roll seam.
    `lookback` is how many prior sessions the reference range averages over —
    14 to match the length candleMeta's own normalizer uses. */
export function seamSessions(
  bars: Bar[],
  dateKeyOf: (unixSec: number) => string,
  ratio: number = SEAM_GAP_RATIO,
  lookback = 14
): SessionGap[] {
  const days = sessionBounds(bars, dateKeyOf);
  const out: SessionGap[] = [];
  for (let i = 1; i < days.length; i++) {
    const window = days.slice(Math.max(0, i - lookback), i);
    const refRange = window.reduce((s, d) => s + d.range, 0) / window.length;
    const gapPoints = Math.abs(days[i].open - days[i - 1].close);
    // A zero reference range means a flat or empty window; calling that a seam
    // on a division by zero would flag the quietest days in the series.
    const r = refRange > 0 ? gapPoints / refRange : 0;
    out.push({
      dateKey: days[i].dateKey,
      gapPoints,
      refRange,
      ratio: r,
      seam: r >= ratio,
    });
  }
  return out;
}

/** The seam date keys as a set, for filtering a bar series. */
export const seamDateKeys = (gaps: SessionGap[]): Set<string> =>
  new Set(gaps.filter((g) => g.seam).map((g) => g.dateKey));

/** Drop every bar belonging to a seam session, and to the `pad` sessions
    after it — a stitched price does not stop mattering at midnight, because
    the zones formed across the seam stay live for days. */
export function dropSeamSessions(
  bars: Bar[],
  dateKeyOf: (unixSec: number) => string,
  ratio: number = SEAM_GAP_RATIO,
  pad = 1
): { bars: Bar[]; dropped: string[] } {
  const days = sessionBounds(bars, dateKeyOf).map((d) => d.dateKey);
  const seams = seamDateKeys(seamSessions(bars, dateKeyOf, ratio));
  const drop = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    if (!seams.has(days[i])) continue;
    for (let k = i; k < Math.min(days.length, i + 1 + pad); k++) drop.add(days[k]);
  }
  return {
    bars: bars.filter((b) => !drop.has(dateKeyOf(b.time))),
    dropped: [...drop].sort(),
  };
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
