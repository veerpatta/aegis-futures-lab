/* Server-side Yahoo fetch for the scheduled engine — same shaping rules as
   app/api/history/route.ts (full globex session, completed 5m bars only). */

import type { Bar } from "@/lib/types";
import { YAHOO_SYMBOLS, type FeedSymbol } from "@/lib/market/contracts";

export async function fetchYahooBars(symbol: FeedSymbol): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    YAHOO_SYMBOLS[symbol]
  )}?interval=5m&range=60d&includePrePost=true&events=div%2Csplits`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 AegisResearch/1.0", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Yahoo upstream ${response.status} for ${symbol}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || `No chart result for ${symbol}`);
  const quote = result.indicators?.quote?.[0] || {};
  const completedBefore = Math.floor(Date.now() / 300000) * 300 - 300;
  const bars = ((result.timestamp || []) as number[])
    .map((time, i) => ({
      time,
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i] || 0,
    }))
    .filter(
      (b) =>
        b.time % 300 === 0 &&
        b.time <= completedBefore &&
        [b.open, b.high, b.low, b.close].every(Number.isFinite)
    );
  if (!bars.length) throw new Error(`No valid session candles for ${symbol}`);
  return bars as Bar[];
}
