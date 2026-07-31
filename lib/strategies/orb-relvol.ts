/* Opening Range Breakout with a relative-volume ("in-play") filter.
 *
 * PHASE 4 HYPOTHESIS — NOT a promoted strategy. It exists to be tested by the
 * same machinery that refuted the incumbents, and it starts with no more
 * standing than they ended with.
 *
 * SOURCE AND ITS LIMITS. Zarattini, Barbon & Aziz (2024) report a large ORB
 * effect on US equities, and the brief's own note on it is the important part:
 * base ORB across all names was WEAK — the relative-volume filter carried the
 * edge — and the results were vendor-data sensitive. So the deliverable here is
 * the FILTER, not the breakout. Three further reasons to expect this may not
 * transfer, recorded before any result is seen:
 *
 *   1. It is equities-derived. Single stocks gap on single-name news, which is
 *      what "in play" is detecting. An index future aggregates hundreds of
 *      names and has no equivalent idiosyncratic catalyst.
 *   2. Volume on a continuous futures contract is contaminated at the roll,
 *      where volume migrates between contract months for reasons that have
 *      nothing to do with the day being in play.
 *   3. Relative volume near the open is partly a clock effect. Comparing to
 *      the SAME minute on prior sessions controls for that; comparing to a
 *      session average would not, and would manufacture a signal from the
 *      shape of the intraday volume curve.
 *
 * This file is separate from orb.ts rather than a parameter on it. orb.ts is
 * auditioning in the shadow lab, and adding a gated parameter would still
 * change its identity in the trial registry; a distinct hypothesis deserves a
 * distinct config hash.
 */

import { nyMeta, NY_SESSION_START_MIN } from "@/lib/time/ny";
import { atr } from "@/lib/indicators";
import type { Bar } from "@/lib/types";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

interface DayState {
  dateKey: string;
  high: number;
  low: number;
  /** Cumulative volume from the session open to each bar index. */
  cumVolume: number;
  longBreakIndex: number | null;
  shortBreakIndex: number | null;
}

interface BarState {
  day: DayState;
  /** Cumulative session volume at this bar. */
  cum: number;
  /** Minutes since the NY session open. */
  sinceOpen: number;
  relVol: number | null;
}

interface Ctx {
  bySymbol: Record<string, Map<number, BarState>>;
  atrBySymbol: Record<string, (number | null)[]>;
}

const ATR_LEN = 14;

/* Relative volume is measured against the SAME minute-of-session on prior
   sessions, so the intraday volume curve cancels out. A trailing median rather
   than a mean: one roll day or one macro print would drag a mean far enough to
   silently gate everything after it. */
function build(bars: Bar[], rangeMinutes: number, bufferPts: number, lookback: number) {
  const completeAtMin = NY_SESSION_START_MIN + rangeMinutes;
  const perBar = new Map<number, BarState>();
  // minutes-since-open -> cumulative volumes seen at that point, newest last
  const history = new Map<number, number[]>();
  let day: DayState | null = null;

  for (let i = 0; i < bars.length; i++) {
    const meta = nyMeta(bars[i].time);
    if (meta.minutes < NY_SESSION_START_MIN || meta.minutes >= 960) continue;

    if (!day || day.dateKey !== meta.dateKey) {
      day = {
        dateKey: meta.dateKey,
        high: -Infinity,
        low: Infinity,
        cumVolume: 0,
        longBreakIndex: null,
        shortBreakIndex: null,
      };
    }
    day.cumVolume += bars[i].volume ?? 0;
    const sinceOpen = meta.minutes - NY_SESSION_START_MIN;

    // Read the prior sessions BEFORE appending today's, or today leaks in.
    const prior = history.get(sinceOpen) ?? [];
    const window = prior.slice(-lookback).filter((v) => v > 0);
    let relVol: number | null = null;
    if (window.length >= Math.min(5, lookback)) {
      const sorted = [...window].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > 0) relVol = day.cumVolume / median;
    }
    history.set(sinceOpen, [...prior, day.cumVolume]);

    if (meta.minutes < completeAtMin) {
      day.high = Math.max(day.high, bars[i].high);
      day.low = Math.min(day.low, bars[i].low);
    } else if (Number.isFinite(day.high) && Number.isFinite(day.low)) {
      if (day.longBreakIndex === null && bars[i].close > day.high + bufferPts)
        day.longBreakIndex = i;
      if (day.shortBreakIndex === null && bars[i].close < day.low - bufferPts)
        day.shortBreakIndex = i;
    }
    perBar.set(i, { day, cum: day.cumVolume, sinceOpen, relVol });
  }
  return perBar;
}

export const orbRelVol: Strategy<Ctx> = {
  id: "orb-relvol",
  name: "Opening Range Breakout + relative volume",
  blurb:
    "Phase 4 hypothesis, untested. Mark the opening range, then take the first breakout ONLY on sessions whose volume is running unusually high for the time of day. The volume filter is the claim; the breakout on its own is known to be weak.",
  symbolMode: "single",
  params: [
    {
      key: "rangeMinutes",
      label: "Opening range",
      type: "number",
      default: 30,
      min: 5,
      max: 90,
      step: 5,
      unit: "min",
    },
    {
      key: "relVolMin",
      label: "Minimum relative volume",
      type: "number",
      default: 1.5,
      min: 0.5,
      max: 5,
      step: 0.1,
      help: "Session volume so far, over the median for the same minute on recent sessions. 1.0 = a normal day. THIS IS THE HYPOTHESIS — every value tried is a separate trial.",
    },
    {
      key: "relVolLookback",
      label: "Relative-volume lookback",
      type: "number",
      default: 14,
      min: 5,
      max: 60,
      step: 1,
      unit: "sessions",
    },
    {
      key: "bufferPts",
      label: "Breakout buffer",
      type: "number",
      default: 1,
      min: 0,
      max: 10,
      step: 0.25,
      unit: "pt",
    },
    {
      key: "stopMode",
      label: "Stop",
      type: "select",
      default: "range",
      options: [
        { value: "range", label: "Opposite side of the opening range" },
        { value: "atr", label: "ATR multiple" },
      ],
    },
    { key: "atrMult", label: "ATR stop multiple", type: "number", default: 1.5, min: 0.5, max: 5, step: 0.25 },
    { key: "targetR", label: "Target (R)", type: "number", default: 2, min: 0.5, max: 10, step: 0.5 },
    { key: "bothSides", label: "Trade both directions", type: "boolean", default: true },
  ],

  prepare(series, params) {
    const rangeMinutes = num(params.rangeMinutes, 30);
    const bufferPts = num(params.bufferPts, 1);
    const lookback = num(params.relVolLookback, 14);
    const bySymbol: Ctx["bySymbol"] = {};
    const atrBySymbol: Ctx["atrBySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      bySymbol[symbol] = build(bars, rangeMinutes, bufferPts, lookback);
      atrBySymbol[symbol] = atr(bars, ATR_LEN);
    }
    return { bySymbol, atrBySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    const relVolMin = num(params.relVolMin, 1.5);
    for (const v of visibleSymbols(snap)) {
      const state = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!state) continue;
      note("evaluated");

      const isLong = state.day.longBreakIndex === v.index;
      const isShort = params.bothSides !== false && state.day.shortBreakIndex === v.index;
      if (!isLong && !isShort) {
        note("noSignal");
        continue;
      }
      // The filter, and the reason this strategy exists. Counted separately so
      // the funnel shows how much of the base signal it removes.
      if (state.relVol === null) {
        note("noRelVolHistory", v.symbol);
        continue;
      }
      if (state.relVol < relVolMin) {
        note("belowRelVol", v.symbol);
        continue;
      }

      const range = state.day;
      let stop: number;
      if (params.stopMode === "atr") {
        const a = ctx.atrBySymbol[v.symbol]?.[v.index];
        if (a === null || a === undefined || !(a > 0)) {
          note("noSignal");
          continue;
        }
        const dist = num(params.atrMult, 1.5) * a;
        stop = isLong ? v.bar.close - dist : v.bar.close + dist;
      } else {
        stop = isLong ? range.low : range.high;
      }
      if (isLong ? stop >= v.bar.close : stop <= v.bar.close) {
        note("noSignal");
        continue;
      }

      out.push({
        symbol: v.symbol,
        side: isLong ? "LONG" : "SHORT",
        stop,
        target: { kind: "rMultiple", r: num(params.targetR, 2) },
        tags: {
          trigger: `${isLong ? "long" : "short"} break, relVol ${state.relVol.toFixed(2)}x`,
          relVol: state.relVol.toFixed(2),
        },
      });
    }
    return out;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const state = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!state) continue;
      rows.push({
        label: `${v.symbol} relative volume`,
        value: state.relVol === null ? "no history yet" : `${state.relVol.toFixed(2)}×`,
        tone: state.relVol === null ? "dim" : state.relVol >= 1.5 ? "good" : "warn",
      });
      if (Number.isFinite(state.day.high)) {
        rows.push({
          label: `${v.symbol} opening range`,
          value: `${state.day.low.toFixed(2)} – ${state.day.high.toFixed(2)}`,
        });
      }
    }
    return rows;
  },
};
