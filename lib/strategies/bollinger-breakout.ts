import { bollinger, type BollingerPoint } from "@/lib/indicators";
import type { EntrySignal, ReadoutRow, Strategy } from "./types";
import { num, visibleSymbols } from "./classic-utils";

/* Squeeze-then-breakout: wait for band width to compress into the bottom
   percentile of its recent history, then trade the first close outside a
   band. Stop at the mid-band; fixed R target or mid-band recross exit. */

interface Ctx {
  bySymbol: Record<string, { bands: (BollingerPoint | null)[]; squeezed: boolean[] }>;
}

const LOOKBACK = 120;

export const bollingerBreakout: Strategy<Ctx> = {
  id: "bollinger-breakout",
  name: "Bollinger Squeeze Breakout",
  blurb:
    "Volatility compression precedes expansion: when band width squeezes into its lowest recent percentile, trade the first close outside a band. Stop at the mid-band.",
  symbolMode: "single",
  params: [
    { key: "length", label: "Band length", type: "number", default: 20, min: 5, max: 60, step: 1 },
    {
      key: "mult",
      label: "Band width",
      type: "number",
      default: 2,
      min: 1,
      max: 4,
      step: 0.25,
      unit: "σ",
    },
    {
      key: "squeezePct",
      label: "Squeeze percentile",
      type: "number",
      default: 25,
      min: 5,
      max: 50,
      step: 5,
      unit: "%",
      help: `Band width must be inside the lowest N% of the last ${LOOKBACK} bars.`,
    },
    {
      key: "exitStyle",
      label: "Exit style",
      type: "select",
      default: "rMultiple",
      options: [
        { value: "rMultiple", label: "Fixed R-multiple target" },
        { value: "midband", label: "Close back through mid-band" },
      ],
    },
    { key: "targetR", label: "Target (R)", type: "number", default: 2, min: 0.5, max: 10, step: 0.5 },
  ],

  prepare(series, params) {
    const length = num(params.length, 20);
    const mult = num(params.mult, 2);
    const pct = num(params.squeezePct, 25) / 100;
    const bySymbol: Ctx["bySymbol"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      const bands = bollinger(bars.map((b) => b.close), length, mult);
      const squeezed = bands.map((p, i) => {
        if (!p) return false;
        const start = Math.max(0, i - LOOKBACK);
        const history: number[] = [];
        for (let j = start; j < i; j++) {
          const q = bands[j];
          if (q) history.push(q.bandwidth);
        }
        if (history.length < 20) return false;
        const rank = history.filter((w) => w <= p.bandwidth).length / history.length;
        return rank <= pct;
      });
      bySymbol[symbol] = { bands, squeezed };
    }
    return { bySymbol };
  },

  onSnapshot(ctx, snap, params, note) {
    const out: EntrySignal[] = [];
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      if (!ind || v.index < 1) continue;
      const band = ind.bands[v.index];
      const prevBand = ind.bands[v.index - 1];
      if (!band || !prevBand) continue;
      note("evaluated");
      // The squeeze must be in effect on the PRIOR bar; the current close breaks out.
      if (!ind.squeezed[v.index - 1]) {
        note("noSignal");
        continue;
      }
      const prevClose = v.bars[v.index - 1].close;
      const longBreak = prevClose <= prevBand.upper && v.bar.close > band.upper;
      const shortBreak = prevClose >= prevBand.lower && v.bar.close < band.lower;
      if (!longBreak && !shortBreak) {
        note("noSignal");
        continue;
      }
      out.push({
        symbol: v.symbol,
        side: longBreak ? "LONG" : "SHORT",
        stop: band.mid,
        target:
          params.exitStyle === "midband"
            ? { kind: "signalOnly" }
            : { kind: "rMultiple", r: num(params.targetR, 2) },
        tags: { trigger: `squeeze break ${longBreak ? "up" : "down"}` },
      });
    }
    return out;
  },

  shouldExit(ctx, snap, position, params) {
    if (params.exitStyle !== "midband") return false;
    const vis = snap.bySymbol[position.symbol];
    if (!vis) return false;
    const band = ctx.bySymbol[position.symbol]?.bands[vis.index];
    if (!band) return false;
    const close = vis.bars[vis.index].close;
    return position.side === "LONG" ? close < band.mid : close > band.mid;
  },

  liveReadout(ctx, snap): ReadoutRow[] {
    const rows: ReadoutRow[] = [];
    for (const v of visibleSymbols(snap)) {
      const ind = ctx.bySymbol[v.symbol];
      const band = ind?.bands[v.index];
      if (!ind || !band) continue;
      rows.push({
        label: `${v.symbol} Bollinger`,
        value: `${band.lower.toFixed(2)} / ${band.mid.toFixed(2)} / ${band.upper.toFixed(2)}${ind.squeezed[v.index] ? " · SQUEEZE" : ""}`,
        tone: ind.squeezed[v.index] ? "warn" : "dim",
      });
    }
    return rows;
  },
};
