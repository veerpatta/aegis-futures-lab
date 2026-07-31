/* Random-entry Monte Carlo — the keystone diagnostic.
 *
 * THE QUESTION: does the entry signal contribute anything, or would coin-flip
 * entries with the same trade management have done as well? Tharp and Basso's
 * result is the reason this test exists: a random entry with a competent
 * trailing stop can look profitable in a trending regime, so a profitable
 * backtest is not evidence of entry edge. Only outperformance against MATCHED
 * random entries is.
 *
 * THE CENTRAL DESIGN DECISION: the null runs through the SAME engine
 * (runBacktest) with the SAME ExecutionConfig as the real book. Trade
 * management, sizing, cost model, session filter and discipline locks are
 * therefore held fixed BY CONSTRUCTION rather than by assertion. This removes
 * an entire class of bug — "the benchmark used a subtly different simulator" —
 * which would silently invalidate the conclusion this whole codebase exists to
 * produce.
 *
 * WHAT IS HELD FIXED (by the sampler): trade count, direction mix, symbol mix,
 * time-of-day distribution, and — depending on mode — session clustering.
 * WHAT IS RANDOMISED: which bar you enter on, and which way you face.
 *
 * LOOK-AHEAD IS A COMPILE ERROR, NOT A TEST. The sampler only ever sees
 * `Candidate`, which carries time/minute/session/index and NO price fields. It
 * is structurally incapable of choosing entries by what price did next. Trade
 * GEOMETRY (stop distance, target) does read price, exactly as the real
 * strategy does — that is shared trade management, not entry selection.
 */

import type { Bar, Trade } from "@/lib/types";
import type { EntrySignal, Strategy, TargetSpec } from "@/lib/strategies/types";
import { nyMeta } from "@/lib/time/ny";
import { atr } from "@/lib/indicators";
import { mulberry32 } from "@/scripts/engine/montecarlo";

/* ── Candidate: what the sampler is allowed to know ──────────────────────
   Deliberately price-free. Adding open/high/low/close here would make
   look-ahead expressible; keep it this way. */
export interface Candidate {
  symbol: string;
  index: number;
  time: number;
  minuteOfDay: number;
  dateKey: string;
}

/** Minute-of-day window an entry must fall inside. Null means no filter. */
export interface SessionWindow {
  fromMin: number;
  toMin: number;
}

export type SamplingMode = "matchDayCounts" | "uniformDays" | "matchSessions";

/* Trade geometry, applied AFTER the entry bar is chosen.
   - "atr" mirrors rsi-reversion exactly: stop = close ∓ atrMult × ATR(len),
     target = a fixed R multiple. For tier B the null's management is not an
     approximation of the real stream's, it is identical.
   - "bootstrap" is for tier A, whose stop is structural (a zone's distal
     line) and cannot be reproduced without zones. Paired (stop, target) draws
     from the real book preserve whatever correlation exists between the two.
     This is an APPROXIMATION and every report must say so. */
export type Geometry =
  | { kind: "atr"; atrLen: number; atrMult: number; targetR: number }
  | { kind: "bootstrap"; draws: { stopAtrMult: number; target: TargetSpec }[] };

/* The distribution of the real book that the null must match. */
export interface EntryProfile {
  n: number;
  nLong: number;
  /** Multiset of entry minutes-of-day from the real book. */
  minutes: number[];
  /** Multiset of per-session trade counts, over sessions that traded. */
  perSessionCounts: number[];
  /** Session keys the real book actually traded (for "matchSessions"). */
  tradedSessions: string[];
}

/* ── Building blocks ─────────────────────────────────────────────────────*/

/* Every bar a random entry is ALLOWED to use: inside the session window, and
   with a following bar in the same session so a next-open fill exists.

   INVARIANT (tests/random-entry.test.ts): every bar the real strategy entered
   on must be in this pool. If the pool is stricter than the strategy, the null
   samples a different universe and the comparison is meaningless while looking
   perfectly healthy — the failure mode a p-value check will not catch. */
export function candidatePool(
  series: Record<string, Bar[]>,
  window: SessionWindow | null,
): Candidate[] {
  const out: Candidate[] = [];
  for (const [symbol, bars] of Object.entries(series)) {
    for (let i = 0; i < bars.length - 1; i++) {
      const m = nyMeta(bars[i].time);
      if (window && (m.minutes < window.fromMin || m.minutes >= window.toMin)) continue;
      if (nyMeta(bars[i + 1].time).dateKey !== m.dateKey) continue;
      out.push({ symbol, index: i, time: bars[i].time, minuteOfDay: m.minutes, dateKey: m.dateKey });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Extract the distribution the null has to reproduce. */
export function profileFrom(trades: Trade[]): EntryProfile {
  const perSession = new Map<string, number>();
  const minutes: number[] = [];
  let nLong = 0;
  for (const t of trades) {
    const m = nyMeta(t.entryTime);
    minutes.push(m.minutes);
    perSession.set(m.dateKey, (perSession.get(m.dateKey) ?? 0) + 1);
    if (t.side === "LONG") nLong++;
  }
  return {
    n: trades.length,
    nLong,
    minutes,
    perSessionCounts: [...perSession.values()],
    tradedSessions: [...perSession.keys()],
  };
}

/* Paired (stop, target) draws for a structural-stop stream. Only trades with
   a usable ATR and initial stop contribute — a trade whose entry bar predates
   the ATR warm-up carries no comparable geometry. */
export function bootstrapGeometry(trades: Trade[]): Geometry {
  const draws: { stopAtrMult: number; target: TargetSpec }[] = [];
  for (const t of trades) {
    const stopDist = Math.abs(t.entryPrice - (t.initialStop ?? t.stop));
    if (!t.atrAtEntry || !(stopDist > 0)) continue;
    const target: TargetSpec =
      t.target === null
        ? { kind: "signalOnly" }
        : { kind: "rMultiple", r: Math.abs(t.target - t.entryPrice) / stopDist };
    draws.push({ stopAtrMult: stopDist / t.atrAtEntry, target });
  }
  return { kind: "bootstrap", draws };
}

/* ── The sampler ─────────────────────────────────────────────────────────*/

export interface DrawnEntry {
  symbol: string;
  time: number;
  side: "LONG" | "SHORT";
  /** Index into a bootstrap geometry's draws; unused for "atr". */
  geometryDraw: number;
}

export interface DrawResult {
  entries: DrawnEntry[];
  /** Minute draws that had no matching bar in the drawn session. */
  minuteMisses: number;
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(xs: T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)];

/* Draw N entries matching the profile.

   Direction is drawn EXACTLY (nLong longs, the rest shorts, then shuffled)
   rather than as N independent coin flips. With i.i.d. flips the realised mix
   drifts by ~sqrt(N) every iteration, so the null would differ from the real
   book in direction balance as well as in timing — two changes at once, and no
   way to attribute the result to either. */
export function drawEntries(
  profile: EntryProfile,
  pool: Candidate[],
  mode: SamplingMode,
  rand: () => number,
  geometryDraws: number,
): DrawResult {
  // session -> minute -> candidate
  const bySession = new Map<string, Map<number, Candidate>>();
  for (const c of pool) {
    let m = bySession.get(c.dateKey);
    if (!m) bySession.set(c.dateKey, (m = new Map()));
    if (!m.has(c.minuteOfDay)) m.set(c.minuteOfDay, c);
  }

  const allSessions = [...bySession.keys()];
  const eligible =
    mode === "matchSessions"
      ? profile.tradedSessions.filter((s) => bySession.has(s))
      : allSessions;
  if (!eligible.length || !profile.n) return { entries: [], minuteMisses: 0 };

  /* How many entries each drawn session gets.
     - matchDayCounts: bootstrap the real per-session count multiset, so the
       null clusters the way the real book clusters. This is the default
       because tier A traded on only 287 of 1,838 sessions — spreading its
       1,180 trades evenly would compare against a completely different
       exposure profile, not against the same strategy with random entries.
     - uniformDays: one entry per draw, sessions uniform. Looser null.
     - matchSessions: the real sessions with the real counts. Strictest —
       holds regime constant as well as clustering. */
  const plan: { session: string; count: number }[] = [];
  let remaining = profile.n;
  const unused = shuffle(eligible, rand);
  let cursor = 0;
  while (remaining > 0) {
    if (cursor >= unused.length) cursor = 0; // reuse sessions if N exceeds supply
    const session = unused[cursor++];
    const count =
      mode === "uniformDays"
        ? 1
        : Math.min(remaining, pick(profile.perSessionCounts, rand) || 1);
    plan.push({ session, count });
    remaining -= count;
  }

  const sides: ("LONG" | "SHORT")[] = shuffle(
    [
      ...Array<"LONG">(profile.nLong).fill("LONG"),
      ...Array<"SHORT">(profile.n - profile.nLong).fill("SHORT"),
    ],
    rand,
  );

  const entries: DrawnEntry[] = [];
  let minuteMisses = 0;
  const taken = new Set<string>();
  for (const { session, count } of plan) {
    const minuteMap = bySession.get(session);
    if (!minuteMap) continue;
    for (let k = 0; k < count; k++) {
      let chosen: Candidate | undefined;
      // Draw a minute from the real book's minute multiset. Retry on a miss
      // (that minute has no bar in this session) rather than snapping to a
      // neighbour, which would bias the realised histogram.
      for (let attempt = 0; attempt < 24 && !chosen; attempt++) {
        const minute = pick(profile.minutes, rand);
        const c = minuteMap.get(minute);
        if (c && !taken.has(`${c.symbol}|${c.time}`)) chosen = c;
        else if (!c) minuteMisses++;
      }
      if (!chosen) continue;
      taken.add(`${chosen.symbol}|${chosen.time}`);
      entries.push({
        symbol: chosen.symbol,
        time: chosen.time,
        side: sides[entries.length] ?? "LONG",
        geometryDraw: geometryDraws ? Math.floor(rand() * geometryDraws) : 0,
      });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return { entries, minuteMisses };
}

/* ── The synthetic strategy ──────────────────────────────────────────────*/

interface RandomCtx {
  atrBySymbol: Record<string, (number | null)[]>;
  queue: Map<string, DrawnEntry>;
}

/* A strategy that enters on exactly the drawn bars and nothing else.

   The engine only calls onSnapshot when flat with no pending fill, so a drawn
   entry landing inside an open trade is silently skipped. That is why the
   caller oversamples and why realisedN is reported: the null's realised trade
   count is an OUTPUT to be checked, not an assumption. */
/* ATR is identical across every iteration of a cell — same bars, same length —
   so computing it inside prepare() would repeat an O(n) pass 1,000 times over
   the same array. Keyed on the bars array identity, which is stable for the
   life of a cell; WeakMap so a finished cell's series can be collected. */
const ATR_MEMO = new WeakMap<Bar[], Map<number, (number | null)[]>>();

function memoAtr(bars: Bar[], len: number): (number | null)[] {
  let byLen = ATR_MEMO.get(bars);
  if (!byLen) ATR_MEMO.set(bars, (byLen = new Map()));
  let series = byLen.get(len);
  if (!series) byLen.set(len, (series = atr(bars, len)));
  return series;
}

export function randomEntryStrategy(entries: DrawnEntry[], geometry: Geometry): Strategy<RandomCtx> {
  const atrLen = geometry.kind === "atr" ? geometry.atrLen : 14;
  return {
    id: "random-entry",
    name: "Random entry (null benchmark)",
    blurb: "Coin-flip entries with the real stream's trade management. Not a strategy.",
    symbolMode: "multi",
    params: [],
    prepare(series) {
      const atrBySymbol: Record<string, (number | null)[]> = {};
      for (const [symbol, bars] of Object.entries(series)) atrBySymbol[symbol] = memoAtr(bars, atrLen);
      return {
        atrBySymbol,
        queue: new Map(entries.map((e) => [`${e.symbol}|${e.time}`, e])),
      };
    },
    onSnapshot(ctx, snap) {
      const out: EntrySignal[] = [];
      for (const [symbol, vis] of Object.entries(snap.bySymbol)) {
        if (!vis) continue;
        const drawn = ctx.queue.get(`${symbol}|${vis.bars[vis.index].time}`);
        if (!drawn) continue;
        const a = ctx.atrBySymbol[symbol]?.[vis.index];
        if (a === null || a === undefined || !(a > 0)) continue;
        const close = vis.bars[vis.index].close;
        const { stopDist, target } =
          geometry.kind === "atr"
            ? { stopDist: geometry.atrMult * a, target: { kind: "rMultiple", r: geometry.targetR } as TargetSpec }
            : (() => {
                const d = geometry.draws[drawn.geometryDraw % geometry.draws.length];
                return { stopDist: d.stopAtrMult * a, target: d.target };
              })();
        if (!(stopDist > 0)) continue;
        out.push({
          symbol,
          side: drawn.side,
          stop: drawn.side === "LONG" ? close - stopDist : close + stopDist,
          target,
          tags: { trigger: "random entry" },
        });
      }
      return out;
    },
  };
}

/* ── Distribution statistics ─────────────────────────────────────────────*/

/** Share of `values` at or below `x`, as a percentile in [0, 100]. */
export function percentileOf(values: number[], x: number): number {
  if (!values.length) return NaN;
  let below = 0;
  for (const v of values) if (v <= x) below++;
  return (below / values.length) * 100;
}

/* One-sided Monte Carlo p-value: P(null >= real).
   The +1s are not cosmetic — they keep the estimate from ever being exactly 0
   or exactly 1, which would claim more certainty than n iterations can carry. */
export function pValueOneSided(nullValues: number[], real: number): number {
  let atLeast = 0;
  for (const v of nullValues) if (v >= real) atLeast++;
  return (1 + atLeast) / (nullValues.length + 1);
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/** Largest absolute gap between two minute-of-day histograms, as a share. */
export function histogramDeviation(a: number[], b: number[]): number {
  if (!a.length || !b.length) return NaN;
  const count = (xs: number[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  let worst = 0;
  for (const key of new Set([...ca.keys(), ...cb.keys()])) {
    worst = Math.max(worst, Math.abs((ca.get(key) ?? 0) / a.length - (cb.get(key) ?? 0) / b.length));
  }
  return worst;
}

/** Deterministic per-iteration seed. Iteration i reproduces standalone. */
export function seedFor(cell: string, iteration: number): number {
  let h = 2166136261 >>> 0;
  const s = `${cell}#${iteration}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const rngFor = (cell: string, iteration: number) => mulberry32(seedFor(cell, iteration));
