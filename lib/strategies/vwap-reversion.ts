import { sessionVwap, stdev } from "@/lib/indicators";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

/* Fade stretched moves back to the session VWAP. Deviation = close − VWAP;
   its rolling standard deviation defines the entry and stop bands. The
   profit target is the VWAP value at signal time. */

interface Ctx {
  bySymbol: Record<string, { vwap: number[]; dev: number[]; sd: (number | null)[] }>;
}

export const vwapReversion: Strategy<Ctx> = {
  id: "vwap-reversion",
  name: "VWAP Reversion",
  blurb:
    "When price stretches several deviations away from the session VWAP, fade it back. Target is the VWAP itself; stop sits a further deviation band away. Resets every session.",
  symbolMode: "single",
  params: [
    {
      key: "entryStdev",
      label: "Entry stretch",
      type: "number",
      default: 2,
      min: 0.5,
      max: 4,
      step: 0.25,
      unit: "σ",
      help: "Trade when |close − VWAP| exceeds this many deviations.",
    },
    {
      key: "stopStdev",
      label: "Stop distance",
      type: "number",
      default: 1.5,
      min: 0.5,
      max: 4,
      step: 0.25,
      unit: "σ",
      help: "Additional deviations beyond the entry for the stop.",
    },
    {
      key: "devWindow",
      label: "Deviation window",
      type: "number",
      default: 20,
      min: 10,
      max: 100,
      step: 5,
      unit: "bars",
    },
  ],

  prepare(series, params) {
    const window = num(params.devWindow, 20);
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      const vwap = sessionVwap(bars);
      const dev = bars.map((b, i) => b.close - vwap[i]);
      bySymbol[symbol] = { vwap, dev, sd: stdev(dev, window) };
    }
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    const entryK = num(params.entryStdev, 2);
    const stopK = num(params.stopStdev, 1.5);
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      const sd = ind?.sd[v.index];
      if (!ind || sd == null || sd <= 0) continue;
      note("evaluated");
      const dev = ind.dev[v.index];
      const vwap = ind.vwap[v.index];
      if (dev <= -entryK * sd) {
        out.push({
          symbol: v.symbol,
          side: "LONG",
          stop: v.bar.close - stopK * sd,
          target: { kind: "price", price: vwap },
          tags: { trigger: `${(dev / sd).toFixed(1)}σ below VWAP` },
        });
      } else if (dev >= entryK * sd) {
        out.push({
          symbol: v.symbol,
          side: "SHORT",
          stop: v.bar.close + stopK * sd,
          target: { kind: "price", price: vwap },
          tags: { trigger: `${(dev / sd).toFixed(1)}σ above VWAP` },
        });
      } else note("noSignal");
    }
    return out;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      const sd = ind?.sd[v.index];
      if (!ind || sd == null || sd <= 0) continue;
      const z = ind.dev[v.index] / sd;
      rows.push({
        label: `${v.symbol} VWAP stretch`,
        value: `${z >= 0 ? "+" : ""}${z.toFixed(2)}σ (VWAP ${ind.vwap[v.index].toFixed(2)})`,
        tone: Math.abs(z) >= 2 ? "warn" : "dim",
      });
    }
    return rows;
  },
};
