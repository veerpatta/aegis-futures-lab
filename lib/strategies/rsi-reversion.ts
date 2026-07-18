import { rsi, atr } from "@/lib/indicators";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

interface Ctx {
  bySymbol: Record<string, { rsi: (number | null)[]; atr: (number | null)[] }>;
}

export const rsiReversion: Strategy<Ctx> = {
  id: "rsi-reversion",
  name: "RSI Mean-Reversion",
  blurb:
    "Fade exhaustion: buy when RSI climbs back out of oversold, short when it drops back out of overbought. ATR stop; exit at a fixed R multiple or when RSI recrosses the midline.",
  symbolMode: "single",
  params: [
    { key: "length", label: "RSI length", type: "number", default: 14, min: 2, max: 50, step: 1 },
    { key: "oversold", label: "Oversold level", type: "number", default: 30, min: 5, max: 45, step: 1 },
    { key: "overbought", label: "Overbought level", type: "number", default: 70, min: 55, max: 95, step: 1 },
    {
      key: "bothSides",
      label: "Trade both directions",
      type: "boolean",
      default: true,
      help: "Off = longs out of oversold only.",
    },
    { key: "atrMult", label: "ATR stop multiple", type: "number", default: 1.5, min: 0.5, max: 5, step: 0.25 },
    {
      key: "exitStyle",
      label: "Exit style",
      type: "select",
      default: "rMultiple",
      options: [
        { value: "rMultiple", label: "Fixed R-multiple target" },
        { value: "midline", label: "RSI recrosses 50" },
      ],
    },
    { key: "targetR", label: "Target (R)", type: "number", default: 1.5, min: 0.5, max: 10, step: 0.5 },
  ],

  prepare(series, params) {
    const len = num(params.length, 14);
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      bySymbol[symbol] = { rsi: rsi(bars.map((b) => b.close), len), atr: atr(bars, 14) };
    }
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    const oversold = num(params.oversold, 30);
    const overbought = num(params.overbought, 70);
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      if (!ind || v.index < 1) continue;
      const r0 = ind.rsi[v.index - 1],
        r1 = ind.rsi[v.index];
      if (r0 === null || r1 === null) continue;
      note("evaluated");
      const longTrigger = r0 < oversold && r1 >= oversold;
      const shortTrigger = params.bothSides !== false && r0 > overbought && r1 <= overbought;
      if (!longTrigger && !shortTrigger) {
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
        side: longTrigger ? "LONG" : "SHORT",
        stop: longTrigger ? v.bar.close - stopDist : v.bar.close + stopDist,
        target:
          params.exitStyle === "midline"
            ? { kind: "signalOnly" }
            : { kind: "rMultiple", r: num(params.targetR, 1.5) },
        tags: { trigger: longTrigger ? `RSI up through ${oversold}` : `RSI down through ${overbought}` },
      });
    }
    return out;
  },

  shouldExit(ctx, snap, position, params) {
    if (params.exitStyle !== "midline") return false;
    const vis = snap.bySymbol[position.symbol];
    if (!vis) return false;
    const r = ctx.bySymbol[position.symbol]?.rsi[vis.index];
    if (r == null) return false;
    return position.side === "LONG" ? r >= 50 : r <= 50;
  },

  liveReadout(ctx, snap, params): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const r = ctx.bySymbol[v.symbol]?.rsi[v.index];
      if (r == null) continue;
      const tone =
        r <= num(params.oversold, 30) ? "good" : r >= num(params.overbought, 70) ? "bad" : "dim";
      rows.push({ label: `${v.symbol} RSI(${params.length})`, value: r.toFixed(1), tone });
    }
    return rows;
  },
};
