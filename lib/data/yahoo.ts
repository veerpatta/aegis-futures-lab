/* Resilient Yahoo chart fetch, shared by the scheduled engine
   (scripts/engine/data.ts) and the API routes (/api/history, /api/market).

   Yahoo's free endpoint fails in bursts — transient 429/5xx, network blips,
   and occasional empty chart payloads. Every fetch retries up to 3 times
   with exponential backoff (1s, 3s, 9s) and alternates between the query1
   and query2 hosts across attempts. The bar-shaping rules are unchanged —
   golden parity depends on them — only the fetching is resilient. */

import type { Bar } from "@/lib/types";
import { YAHOO_SYMBOLS, type FeedSymbol } from "@/lib/market/contracts";

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const BACKOFF_MS = [1_000, 3_000, 9_000];

export interface ChartQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

export interface ChartResult {
  meta: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: ChartQuote[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Fetch chart data for a raw Yahoo symbol and run it through `shape`.
   A throw anywhere — network, non-200, missing chart result, or shape
   rejecting an empty/invalid payload — triggers the next attempt on the
   alternate host. */
export async function fetchChartBySymbol<T>(
  vendorSymbol: string,
  interval: "1m" | "5m" | "1d",
  range: string,
  shape: (result: ChartResult) => T
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    const host = HOSTS[attempt % HOSTS.length];
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
        vendorSymbol
      )}?interval=${interval}&range=${range}&includePrePost=true&events=div%2Csplits`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 AegisResearch/1.0", Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Yahoo upstream ${response.status} for ${vendorSymbol}`);
      const json = await response.json();
      const result = json?.chart?.result?.[0];
      if (!result)
        throw new Error(json?.chart?.error?.description || `No chart result for ${vendorSymbol}`);
      return shape(result as ChartResult);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function fetchChart<T>(
  symbol: FeedSymbol,
  interval: "1m" | "5m",
  range: string,
  shape: (result: ChartResult) => T
): Promise<T> {
  return fetchChartBySymbol(YAHOO_SYMBOLS[symbol], interval, range, shape);
}

export function rawBars(result: ChartResult): Bar[] {
  const quote = result.indicators?.quote?.[0] || {};
  return ((result.timestamp || []) as number[]).map((time, i) => ({
    time,
    open: quote.open?.[i],
    high: quote.high?.[i],
    low: quote.low?.[i],
    close: quote.close?.[i],
    volume: quote.volume?.[i] || 0,
  })) as Bar[];
}

/* The engine/history shaping: full ~23h globex session, 5m-aligned,
   completed bars only, finite OHLC. EXACTLY the legacy rules. */
export function shapeCompleted5mBars(result: ChartResult, symbol: string): Bar[] {
  const completedBefore = Math.floor(Date.now() / 300000) * 300 - 300;
  const bars = rawBars(result).filter(
    (b) =>
      b.time % 300 === 0 &&
      b.time <= completedBefore &&
      [b.open, b.high, b.low, b.close].every(Number.isFinite)
  );
  if (!bars.length) throw new Error(`No valid session candles for ${symbol}`);
  return bars;
}

/* Trailing 60 days of completed 5-minute bars — the engine's data feed. */
export function fetchYahooBars(symbol: FeedSymbol): Promise<Bar[]> {
  return fetchChart(symbol, "5m", "60d", (result) => shapeCompleted5mBars(result, symbol));
}
