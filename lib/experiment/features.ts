/* Features frozen at decision time.

   The layout is winprob's ModelRow, so the existing v1 and v2 featurizers
   (scripts/engine/winprob.ts, winprob-v2.ts) read it unchanged. The two
   context numbers come from bars that had CLOSED by the decision's
   information cutoff — the same bar the nightly learner uses (the bar before
   the idea's entry bar) when it is available, never a later one. */

import type { Bar } from "@/lib/types";
import { marketContexts, type MarketContext } from "@/lib/strategies/research-v2";
import type { ModelRow } from "@/scripts/engine/winprob";
import type { FrozenFeatures, Opportunity } from "./types";

export const EXP_FEATURE_VERSION = "exp-features-1";
const BAR_SEC = 300;

export interface ContextIndex {
  bars: Bar[];
  contexts: MarketContext[];
  byTime: Map<number, number>;
}

export function contextIndex(bars: Bar[]): ContextIndex {
  return { bars, contexts: marketContexts(bars), byTime: new Map(bars.map((b, i) => [b.time, i])) };
}

export function freezeFeatures(op: Opportunity, ctx: ContextIndex | null, infoCutoff: number): FrozenFeatures {
  let atr_pct: number | null = null, vwap_atr: number | null = null;
  if (ctx && ctx.bars.length) {
    let i = ctx.byTime.get(op.signalTs - BAR_SEC);
    if (i === undefined || ctx.bars[i].time + BAR_SEC > infoCutoff) {
      // Fall back to the newest bar closed by the cutoff.
      i = undefined;
      for (let j = ctx.bars.length - 1; j >= 0; j--) if (ctx.bars[j].time + BAR_SEC <= Math.min(infoCutoff, op.signalTs)) { i = j; break; }
    }
    if (i !== undefined) {
      const c = ctx.contexts[i], close = ctx.bars[i].close;
      atr_pct = c.atr && close ? (100 * c.atr) / close : null;
      vwap_atr = c.atr && c.vwap !== null ? (close - c.vwap) / c.atr : null;
    }
  }
  return {
    tier: op.tier, regime: op.regime, vix_bucket: op.vixBucket, score: op.score, rr: op.rr,
    signal_ts: new Date(op.signalTs * 1000).toISOString(), symbol: op.symbol, strategy: op.strategy, atr_pct, vwap_atr,
  };
}

export function toModelRow(f: FrozenFeatures): ModelRow {
  return { ...f, pnl_usd: null, fill_confidence: null };
}
