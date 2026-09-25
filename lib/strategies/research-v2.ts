/** Frozen hypotheses, September 2026. Separate IDs preserve the losing controls. */
import type { Bar } from "@/lib/types";
import { atr } from "@/lib/indicators";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import { computeRegime } from "@/scripts/engine/regime";
import { zoneV5 } from "./zone-v5";
import { rsiReversion } from "./rsi-reversion";
import { defaultParams, type Strategy, type ParamValues, type EntrySignal } from "./types";

export const RESEARCH_IDS = ["zone-rejection-v2", "rsi-context-v2", "vwap-pullback-v1"] as const;
export const RESEARCH_VERSION = "2026-09-25.1";
export const ZONE_REJECTION_PARAMS: ParamValues = {
  ...defaultParams(zoneV5 as Strategy<unknown>), causalBlocked80: true,
  sessionAnchoredFrames: true, globexDailyRoll: true, entryStyle: "confirm",
  entryHours: "rth", targetMode: "r2", firstRetestOnly: true,
  breakevenR: 0, trailR: 0,
};
export const RSI_CONTEXT_PARAMS: ParamValues = {
  ...defaultParams(rsiReversion as Strategy<unknown>), oversold: 25, overbought: 75,
  atrMult: 1.5, targetR: 1.5, session: "day", requireContiguous: true,
};

export interface MarketContext { atr: number | null; vwap: number | null; vwapSlope: number; emaSlope: number; }
/** Each element uses only bars through that element's close. Incomplete 30m buckets never enter EMA. */
export function marketContexts(bars: Bar[]): MarketContext[] {
  const volatility = atr(bars, 14);
  let day = "", pv = 0, volume = 0, prevVwap = 0, bucket = -1, count = 0;
  let closes: number[] = [], ema: number | null = null, emaSlope = 0;
  return bars.map((b, i) => {
    const dk = tradingDayKey(b.time);
    if (dk !== day) { day = dk; pv = 0; volume = 0; prevVwap = 0; }
    const vol = Math.max(0, b.volume ?? 0);
    pv += ((b.high + b.low + b.close) / 3) * vol; volume += vol;
    const vwap = volume > 0 ? pv / volume : null;
    const nextBucket = Math.floor(b.time / 1800);
    if (nextBucket !== bucket) { bucket = nextBucket; count = 0; }
    count++;
    if ((b.time + 300) % 1800 === 0 && count === 6 && i >= 5 && b.time - bars[i - 5].time === 1500) {
      closes.push(b.close);
      if (closes.length >= 20) {
        const next = ema === null ? closes.slice(-20).reduce((a, c) => a + c, 0) / 20 : ema + (2 / 21) * (b.close - ema);
        emaSlope = ema === null ? 0 : next - ema; ema = next;
      }
    }
    const vwapSlope = vwap !== null && prevVwap ? vwap - prevVwap : 0;
    prevVwap = vwap ?? 0;
    return { atr: volatility[i], vwap, vwapSlope, emaSlope };
  });
}

export const zoneRejection = {
  ...zoneV5, id: RESEARCH_IDS[0], name: "Zone rejection confirmation",
  blurb: "Research only. First retest must close back outside the zone. Next-open entry and a 2R target.",
  params: [], flagship: false,
  prepare: (series, _params, execution) => zoneV5.prepare(series, ZONE_REJECTION_PARAMS, execution),
  onSnapshot: (ctx, snap, _params, note) => zoneV5.onSnapshot(ctx, snap, ZONE_REJECTION_PARAMS, note),
  adjustStop: undefined, liveReadout: undefined,
} satisfies typeof zoneV5;

type RsiCtx = { base: ReturnType<typeof rsiReversion.prepare>; contexts: Record<string, MarketContext[]> };
export const rsiContext: Strategy<RsiCtx> = {
  id: RESEARCH_IDS[1], name: "RSI with market context", symbolMode: "single", feeds: ["MES", "MNQ"], params: [],
  blurb: "Research only. RSI reversal in a quiet range, at least one ATR from session VWAP.",
  prepare(series, _params, execution) {
    return { base: rsiReversion.prepare(series, RSI_CONTEXT_PARAMS, execution),
      contexts: Object.fromEntries(Object.entries(series).map(([symbol, bars]) => [symbol, marketContexts(bars)])) };
  },
  onSnapshot(ctx, snap, _params, note) {
    return rsiReversion.onSnapshot(ctx.base, snap, RSI_CONTEXT_PARAMS, note).filter(s => {
      const vis = snap.bySymbol[s.symbol]!; const c = ctx.contexts[s.symbol][vis.index];
      const bar = vis.bars[vis.index];
      const valid = c.vwap !== null && c.atr !== null && c.atr > 0 &&
        Math.abs(bar.close - c.vwap) >= c.atr &&
        computeRegime(vis.bars.slice(Math.max(0, vis.index - 6000), vis.index + 1), bar.time + 300) === "range-low-vol";
      if (!valid) note("marketContext", s.symbol);
      return valid;
    });
  },
};

type TrendCtx = { entries: Record<string, Map<number, EntrySignal>> };
export const vwapPullback: Strategy<TrendCtx> = {
  id: RESEARCH_IDS[2], name: "Trend pullback to VWAP", symbolMode: "single", feeds: ["MES", "MNQ"], params: [],
  blurb: "Research only. First daily VWAP rejection with matching completed 30-minute trend. Next-open entry and 2R target.",
  prepare(series) {
    const entries: TrendCtx["entries"] = {};
    for (const [symbol, bars] of Object.entries(series)) {
      const contexts = marketContexts(bars), signals = new Map<number, EntrySignal>(), used = new Set<string>();
      for (let i = 2; i < bars.length; i++) {
        const b = bars[i], c = contexts[i], m = nyMeta(b.time);
        if (m.minutes < 570 || m.minutes >= 925 || !c.vwap || bars[i - 2].time !== b.time - 600) continue;
        const long = c.emaSlope > 0 && c.vwapSlope > 0 && b.low <= c.vwap && b.close > c.vwap && b.close > b.open;
        const short = c.emaSlope < 0 && c.vwapSlope < 0 && b.high >= c.vwap && b.close < c.vwap && b.close < b.open;
        if (!long && !short) continue;
        const side = long ? "LONG" : "SHORT", key = `${m.dateKey}:${side}`;
        if (used.has(key)) continue;
        used.add(key);
        signals.set(b.time, { symbol, side, stop: long ? Math.min(...bars.slice(i - 2, i + 1).map(x => x.low)) - 0.25 : Math.max(...bars.slice(i - 2, i + 1).map(x => x.high)) + 0.25,
          target: { kind: "rMultiple", r: 2 }, tags: { trigger: "First VWAP rejection with completed 30m trend", version: RESEARCH_VERSION } });
      }
      entries[symbol] = signals;
    }
    return { entries };
  },
  onSnapshot(ctx, snap) { return Object.values(ctx.entries).flatMap(map => map.has(snap.time) ? [map.get(snap.time)!] : []); },
};
