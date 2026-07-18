import { nyMeta, NY_SESSION_START_MIN } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

/* Opening Range Breakout. The opening range (first N minutes from 09:30 NY)
   and the FIRST breakout bar per side per session are precomputed in
   prepare(), so onSnapshot stays a pure index lookup — and each side fires
   at most once per session. */

interface SessionRange {
  high: number;
  low: number;
  completeAtMin: number;
  longBreakIndex: number | null;
  shortBreakIndex: number | null;
}

interface Ctx {
  bySymbol: Record<string, Map<number, { dateKey: string; range: SessionRange } | undefined>>;
}

function buildSessions(bars: Bar[], rangeMinutes: number, bufferPts: number) {
  const byDate = new Map<string, SessionRange>();
  const perIndex = new Map<number, { dateKey: string; range: SessionRange }>();
  const completeAtMin = NY_SESSION_START_MIN + rangeMinutes;
  for (let i = 0; i < bars.length; i++) {
    const meta = nyMeta(bars[i].time);
    let range = byDate.get(meta.dateKey);
    if (meta.minutes < completeAtMin) {
      if (!range) {
        range = {
          high: bars[i].high,
          low: bars[i].low,
          completeAtMin,
          longBreakIndex: null,
          shortBreakIndex: null,
        };
        byDate.set(meta.dateKey, range);
      } else {
        range.high = Math.max(range.high, bars[i].high);
        range.low = Math.min(range.low, bars[i].low);
      }
    } else if (range) {
      if (range.longBreakIndex === null && bars[i].close > range.high + bufferPts)
        range.longBreakIndex = i;
      if (range.shortBreakIndex === null && bars[i].close < range.low - bufferPts)
        range.shortBreakIndex = i;
    }
    if (range) perIndex.set(i, { dateKey: meta.dateKey, range });
  }
  return perIndex;
}

export const orb: Strategy<Ctx> = {
  id: "orb",
  name: "Opening Range Breakout",
  blurb:
    "Mark the first minutes of the New York session, then trade the first close beyond that range. Stop at the opposite side of the range; fixed R-multiple target, flat by the session close.",
  symbolMode: "single",
  params: [
    {
      key: "rangeMinutes",
      label: "Opening range",
      type: "number",
      default: 30,
      min: 15,
      max: 90,
      step: 15,
      unit: "min",
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
      help: "The close must clear the range by this many points.",
    },
    { key: "targetR", label: "Target (R)", type: "number", default: 2, min: 0.5, max: 10, step: 0.5 },
    {
      key: "bothSides",
      label: "Trade both directions",
      type: "boolean",
      default: true,
    },
  ],

  prepare(series, params) {
    const rangeMinutes = num(params.rangeMinutes, 30);
    const bufferPts = num(params.bufferPts, 1);
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series))
      bySymbol[symbol] = buildSessions(bars, rangeMinutes, bufferPts);
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    for (const v of visibleSymbols(snap)) {
      const entry = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!entry) continue;
      note("evaluated");
      const { range } = entry;
      const isLongBreak = range.longBreakIndex === v.index;
      const isShortBreak =
        params.bothSides !== false && range.shortBreakIndex === v.index;
      if (!isLongBreak && !isShortBreak) {
        note("noSignal");
        continue;
      }
      out.push({
        symbol: v.symbol,
        side: isLongBreak ? "LONG" : "SHORT",
        stop: isLongBreak ? range.low : range.high,
        target: { kind: "rMultiple", r: num(params.targetR, 2) },
        tags: {
          trigger: `${isLongBreak ? "long" : "short"} break of ${range.low.toFixed(2)}–${range.high.toFixed(2)}`,
        },
      });
    }
    return out;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const entry = ctx.bySymbol[v.symbol]?.get(v.index);
      if (!entry) continue;
      const meta = nyMeta(v.bar.time);
      const formed = meta.minutes >= entry.range.completeAtMin;
      rows.push({
        label: `${v.symbol} opening range`,
        value: formed
          ? `${entry.range.low.toFixed(2)} – ${entry.range.high.toFixed(2)}`
          : "forming…",
        tone: formed ? undefined : "dim",
      });
    }
    return rows;
  },
};
