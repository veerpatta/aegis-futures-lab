/* Market-regime tag stamped on each signal at entry time. Bookkeeping for
   the dashboard's performance split — NEVER a filter; strategy logic does
   not read it.

   The exact rule, deterministic on the bars already in memory:

   1. Aggregate the symbol's 5m series into 1H bars (clock-aligned buckets,
      floor(time/3600)), and keep only hours fully completed by the entry
      time so nothing reads the future.
   2. Volatility: ATR(14) = simple mean of the last 14 true ranges on those
      1H bars. "high-vol" when the entry-time ATR is strictly greater than
      the median ATR over the trailing 20 days of hourly ATR values
      (~480 globex hours); "low-vol" otherwise.
   3. Trend: EMA(20) vs EMA(50) on 1H closes (SMA-seeded). "trend" when
      price and the EMAs agree on a side — close above EMA20 with
      EMA20 > EMA50, or close below EMA20 with EMA20 < EMA50 — and
      "range" otherwise.

   Returns null when there is not enough history (50 completed 1H bars —
   the EMA(50) seed — which also covers the ATR window). */

import type { Bar } from "@/lib/types";

export type Regime = "trend-high-vol" | "trend-low-vol" | "range-high-vol" | "range-low-vol";

const HOUR = 3600;
const ATR_LEN = 14;
const EMA_FAST = 20;
const EMA_SLOW = 50;
const MEDIAN_WINDOW_HOURS = 20 * 24; // trailing 20 days of hourly ATR values

export function aggregate1h(bars: Bar[], entrySec: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const bucket = Math.floor(b.time / HOUR) * HOUR;
    if (bucket + HOUR > entrySec) break; // only fully completed hours
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else {
      out.push({ time: bucket, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }
  return out;
}

function ema(values: number[], len: number): number | null {
  if (values.length < len) return null;
  let e = values.slice(0, len).reduce((a, v) => a + v, 0) / len; // SMA seed
  const k = 2 / (len + 1);
  for (let i = len; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/* ATR series: simple mean of the trailing ATR_LEN true ranges, one value
   per 1H bar from index ATR_LEN onward. */
function atrSeries(bars: Bar[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i],
      prevClose = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose)));
  }
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= ATR_LEN) sum -= tr[i - ATR_LEN];
    if (i >= ATR_LEN - 1) out.push(sum / ATR_LEN);
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeRegime(bars: Bar[], entrySec: number): Regime | null {
  const h1 = aggregate1h(bars, entrySec);
  if (h1.length < EMA_SLOW) return null;

  const atr = atrSeries(h1);
  if (!atr.length) return null;
  const current = atr[atr.length - 1];
  const window = atr.slice(-MEDIAN_WINDOW_HOURS);
  const highVol = current > median(window);

  const closes = h1.map((b) => b.close);
  const fast = ema(closes, EMA_FAST);
  const slow = ema(closes, EMA_SLOW);
  if (fast === null || slow === null) return null;
  const close = closes[closes.length - 1];
  const trending = (close > fast && fast > slow) || (close < fast && fast < slow);

  return `${trending ? "trend" : "range"}-${highVol ? "high" : "low"}-vol` as Regime;
}
