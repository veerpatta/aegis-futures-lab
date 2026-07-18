import { ema, atr } from "@/lib/indicators";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { crossedDown, crossedUp, num, visibleSymbols } from "./classic-utils";

interface Ctx {
  bySymbol: Record<
    string,
    { fast: (number | null)[]; slow: (number | null)[]; atr: (number | null)[] }
  >;
}

export const emaCross: Strategy<Ctx> = {
  id: "ema-cross",
  name: "EMA Crossover",
  blurb:
    "Classic trend-following: go long when the fast EMA crosses above the slow EMA, short on the opposite cross. ATR-sized stop; exit on the counter-cross or at a fixed R multiple.",
  symbolMode: "single",
  params: [
    { key: "fast", label: "Fast EMA", type: "number", default: 9, min: 2, max: 50, step: 1 },
    { key: "slow", label: "Slow EMA", type: "number", default: 21, min: 5, max: 200, step: 1 },
    {
      key: "atrMult",
      label: "ATR stop multiple",
      type: "number",
      default: 1.5,
      min: 0.5,
      max: 5,
      step: 0.25,
      help: "Stop distance = multiple × ATR(14) at signal time.",
    },
    {
      key: "exitStyle",
      label: "Exit style",
      type: "select",
      default: "cross",
      options: [
        { value: "cross", label: "Opposite EMA cross" },
        { value: "rMultiple", label: "Fixed R-multiple target" },
      ],
    },
    {
      key: "targetR",
      label: "Target (R)",
      type: "number",
      default: 2,
      min: 0.5,
      max: 10,
      step: 0.5,
      help: "Used when exit style is a fixed R-multiple.",
    },
  ],

  prepare(series, params) {
    const fastLen = num(params.fast, 9);
    const slowLen = num(params.slow, 21);
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      const closes = bars.map((b) => b.close);
      bySymbol[symbol] = {
        fast: ema(closes, fastLen),
        slow: ema(closes, slowLen),
        atr: atr(bars, 14),
      };
    }
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      if (!ind || v.index < 1) continue;
      note("evaluated");
      const up = crossedUp(ind.fast, ind.slow, v.index);
      const down = crossedDown(ind.fast, ind.slow, v.index);
      if (!up && !down) {
        note("noSignal");
        continue;
      }
      const a = ind.atr[v.index];
      if (a === null || a <= 0) {
        note("noSignal");
        continue;
      }
      const stopDist = num(params.atrMult, 1.5) * a;
      out.push({
        symbol: v.symbol,
        side: up ? "LONG" : "SHORT",
        stop: up ? v.bar.close - stopDist : v.bar.close + stopDist,
        target:
          params.exitStyle === "rMultiple"
            ? { kind: "rMultiple", r: num(params.targetR, 2) }
            : { kind: "signalOnly" },
        tags: { trigger: up ? "golden cross" : "death cross" },
      });
    }
    return out;
  },

  shouldExit(ctx, snap, position, params) {
    if (params.exitStyle === "rMultiple") return false;
    const vis = snap.bySymbol[position.symbol];
    if (!vis || vis.index < 1) return false;
    const ind = ctx.bySymbol[position.symbol];
    return position.side === "LONG"
      ? crossedDown(ind.fast, ind.slow, vis.index)
      : crossedUp(ind.fast, ind.slow, vis.index);
  },

  liveReadout(ctx, snap, params): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      const f = ind?.fast[v.index],
        s = ind?.slow[v.index];
      if (f == null || s == null) continue;
      rows.push({
        label: `${v.symbol} EMA ${params.fast}/${params.slow}`,
        value: `${f.toFixed(2)} vs ${s.toFixed(2)} — ${f > s ? "bullish" : "bearish"}`,
        tone: f > s ? "good" : "bad",
      });
    }
    return rows;
  },
};
