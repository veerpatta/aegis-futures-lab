/* Overnight vs intraday return decomposition.
 *
 * WHY THIS IS THE MOST IMPORTANT PHASE 4 DIAGNOSTIC, and why it is a
 * diagnostic rather than a strategy: it tests a claim about the ARENA, not
 * about a signal. If most of the drift in these instruments accrues between
 * the close and the next open, then a system that is flat every night —
 * which this one is, by SESSION_EXIT_MINUTE — is not competing for that drift
 * at all. It is fishing in the half of the day where the fish aren't.
 *
 * That would reframe the entire Phase 1 result. "No entry edge" and "the
 * available intraday drift is near zero" are different diagnoses with
 * different cures, and only one of them is fixed by finding a better signal.
 *
 * The split, per session:
 *   OVERNIGHT = previous session's close  →  this session's open
 *   INTRADAY  = this session's open       →  this session's close
 * Their sum is the close-to-close return, which is asserted in tests: if the
 * two pieces do not add up, the session boundaries are wrong.
 *
 * A caveat that must travel with the number: on a CONTINUOUS futures contract
 * the overnight leg spans the roll, where the price series steps between
 * contract months. Roll seams are therefore excluded via the same detector the
 * baselines use (lib/data/feed-delta.ts), and the exclusion count is reported.
 */

import type { Bar } from "@/lib/types";
import { nyMeta, NY_SESSION_START_MIN, NY_SESSION_END_MIN } from "@/lib/time/ny";
import { bootstrapMean, type Interval } from "./horizonReturns";

export interface SessionEnds {
  dateKey: string;
  open: number;
  close: number;
  openTime: number;
  closeTime: number;
}

/** First and last RTH bar of each session, in order. */
export function sessionEnds(bars: Bar[]): SessionEnds[] {
  const out: SessionEnds[] = [];
  let current: SessionEnds | null = null;
  for (const b of bars) {
    const m = nyMeta(b.time);
    if (m.minutes < NY_SESSION_START_MIN || m.minutes >= NY_SESSION_END_MIN) continue;
    if (!current || current.dateKey !== m.dateKey) {
      if (current) out.push(current);
      current = {
        dateKey: m.dateKey,
        open: b.open,
        close: b.close,
        openTime: b.time,
        closeTime: b.time,
      };
    } else {
      current.close = b.close;
      current.closeTime = b.time;
    }
  }
  if (current) out.push(current);
  return out;
}

export interface OvernightSplit {
  sessions: number;
  excludedSeams: number;
  /** Mean log return per session, in basis points. */
  overnightBps: Interval;
  intradayBps: Interval;
  closeToCloseBps: Interval;
  /** Cumulative log return over the whole sample, in percent. */
  overnightTotalPct: number;
  intradayTotalPct: number;
  /** Share of total close-to-close drift earned overnight. */
  overnightShare: number;
  /** Sessions where the overnight leg was positive. */
  overnightWinRate: number;
  intradayWinRate: number;
}

export interface OvernightOptions {
  /** Absolute log-return threshold above which a gap is treated as a roll. */
  seamThreshold?: number;
  iterations?: number;
  seed?: number;
}

/* 4% in one overnight gap is far outside anything these indices do on a normal
   night and is the signature of a contract roll rather than a market move.
   Deliberately generous: a threshold tight enough to catch every roll would
   also discard real crisis gaps, which are exactly the sessions a study of
   overnight drift must keep. */
export const DEFAULT_SEAM_THRESHOLD = 0.04;

export function overnightSplit(bars: Bar[], opts: OvernightOptions = {}): OvernightSplit {
  const threshold = opts.seamThreshold ?? DEFAULT_SEAM_THRESHOLD;
  const ends = sessionEnds(bars);
  const overnight: number[] = [];
  const intraday: number[] = [];
  const c2c: number[] = [];
  let excludedSeams = 0;

  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1];
    const cur = ends[i];
    if (!(prev.close > 0) || !(cur.open > 0) || !(cur.close > 0)) continue;
    const on = Math.log(cur.open / prev.close);
    if (Math.abs(on) > threshold) {
      excludedSeams++;
      continue;
    }
    const id = Math.log(cur.close / cur.open);
    overnight.push(on);
    intraday.push(id);
    c2c.push(on + id);
  }

  const toBps = (xs: number[]): Interval => {
    const ci = bootstrapMean(xs, opts.iterations ?? 2000, opts.seed ?? 23);
    return { mean: ci.mean * 10000, lo: ci.lo * 10000, hi: ci.hi * 10000 };
  };
  const total = (xs: number[]) => (Math.exp(xs.reduce((a, v) => a + v, 0)) - 1) * 100;
  const winRate = (xs: number[]) => (xs.length ? xs.filter((v) => v > 0).length / xs.length : NaN);
  const onTotal = overnight.reduce((a, v) => a + v, 0);
  const idTotal = intraday.reduce((a, v) => a + v, 0);

  return {
    sessions: overnight.length,
    excludedSeams,
    overnightBps: toBps(overnight),
    intradayBps: toBps(intraday),
    closeToCloseBps: toBps(c2c),
    overnightTotalPct: total(overnight),
    intradayTotalPct: total(intraday),
    // Share of the combined drift; undefined when the two legs cancel out.
    overnightShare: Math.abs(onTotal + idTotal) > 1e-12 ? onTotal / (onTotal + idTotal) : NaN,
    overnightWinRate: winRate(overnight),
    intradayWinRate: winRate(intraday),
  };
}

export function describeOvernight(s: OvernightSplit, symbol: string): string {
  if (!s.sessions) return `${symbol}: no sessions to decompose.`;
  const on = s.overnightTotalPct;
  const id = s.intradayTotalPct;
  const head =
    `${symbol}, ${s.sessions.toLocaleString()} sessions (${s.excludedSeams} roll seams excluded): ` +
    `overnight ${on >= 0 ? "+" : ""}${on.toFixed(1)}% cumulative ` +
    `(${s.overnightBps.mean.toFixed(2)} bps/session), ` +
    `intraday ${id >= 0 ? "+" : ""}${id.toFixed(1)}% ` +
    `(${s.intradayBps.mean.toFixed(2)} bps/session). `;
  if (id < 0 && on > 0) {
    return (
      head +
      "All of the drift is overnight and the intraday leg is negative — a long-biased " +
      "intraday system is fighting a structural headwind, not merely failing to find edge."
    );
  }
  if (on > id * 2 && on > 0) {
    return head + "The large majority of drift accrues overnight, where a flat-by-close system cannot reach it.";
  }
  return head + "Drift is not concentrated overnight in this sample.";
}
