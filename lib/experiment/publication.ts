/** Keep the portfolio behind the source's existing eligibility window.
 * The top-level MES/MNQ boundaries remain safe for older runners. Versioned
 * metadata in the existing JSON document keeps feed age separate from this
 * intentional processing delay. No price, outcome or earlier ledger is edited. */
import { STALE_BAR_AGE_MIN } from "@/lib/signals/freshness";
import { BAR_SEC } from "./execution";
import { EXP_SYMBOLS, type ExpSymbol } from "./types";

export type MarketWatermarks = Partial<Record<ExpSymbol, number>>;
export interface PublicationWatermarks extends MarketWatermarks {
  version?: 2;
  available?: MarketWatermarks;
  settlementSeconds?: number;
}

export function publicationWatermarks(
  marketAsOf: Record<string, string | null>, archived: MarketWatermarks, nowSec: number,
  settlementSeconds = STALE_BAR_AGE_MIN * 60,
): PublicationWatermarks {
  if (!Number.isFinite(settlementSeconds) || settlementSeconds < 0)
    throw new Error("Invalid source eligibility window.");
  const available: MarketWatermarks = {}, ready: MarketWatermarks = {};
  for (const symbol of EXP_SYMBOLS) {
    const source = marketAsOf[symbol] ? Date.parse(marketAsOf[symbol]!) / 1000 : NaN;
    const stored = archived[symbol];
    if (!Number.isFinite(source) || !Number.isFinite(stored) || !Number.isFinite(nowSec))
      throw new Error(`Completed source and archive times are required for ${symbol}.`);
    const end = Math.floor(Math.min(source, stored!, nowSec) / BAR_SEC) * BAR_SEC;
    available[symbol] = end;
    // staleAtSignal compares ENTRY time with the latest bar START. A decision
    // occurs one bar later, so subtracting the same window from the bar END
    // admits the idea exactly when the producer can publish it.
    ready[symbol] = Math.floor((end - settlementSeconds) / BAR_SEC) * BAR_SEC;
  }
  return { ...ready, version: 2, available, settlementSeconds };
}

/** Older publications have no holdback metadata and keep their old meaning. */
export function availableWatermarks(watermarks: PublicationWatermarks): MarketWatermarks {
  return watermarks.version === 2 && watermarks.available ? watermarks.available : watermarks;
}
