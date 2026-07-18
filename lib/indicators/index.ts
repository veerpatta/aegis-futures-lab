import type { Bar } from "@/lib/types";
import { nyDateKey } from "@/lib/time/ny";

/* All indicator series are aligned to the input bars: value at index i uses
   bars[0..i] only, so walking forward never reads the future. Values are
   null until the indicator has enough history. */

export function sma(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function ema(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (length + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      seed += values[i];
      if (i === length - 1) prev = seed / length;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/* Wilder's RSI. */
export function rsi(closes: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let avgGain = 0,
    avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change),
      loss = Math.max(0, -change);
    if (i <= length) {
      avgGain += gain / length;
      avgLoss += loss / length;
      if (i === length) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/* Wilder's ATR on OHLC bars. */
export function atr(bars: Bar[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = i > 0 ? bars[i - 1].close : b.close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    if (prev === null) {
      seed += tr;
      if (i === length - 1) prev = seed / length;
    } else {
      prev = (prev * (length - 1) + tr) / length;
    }
    out[i] = prev;
  }
  return out;
}

export function stdev(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0,
    sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= length) {
      sum -= values[i - length];
      sumSq -= values[i - length] * values[i - length];
    }
    if (i >= length - 1) {
      const mean = sum / length;
      const variance = Math.max(0, sumSq / length - mean * mean);
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

export interface BollingerPoint {
  mid: number;
  upper: number;
  lower: number;
  bandwidth: number;
}

export function bollinger(
  closes: number[],
  length: number,
  mult: number
): (BollingerPoint | null)[] {
  const mids = sma(closes, length);
  const sds = stdev(closes, length);
  return closes.map((_, i) => {
    const mid = mids[i],
      sd = sds[i];
    if (mid === null || sd === null) return null;
    const upper = mid + mult * sd,
      lower = mid - mult * sd;
    return { mid, upper, lower, bandwidth: mid !== 0 ? (upper - lower) / Math.abs(mid) : 0 };
  });
}

/* Volume-weighted average price, reset at each NY session date. Falls back
   to the typical price with unit weight when a bar carries no volume. */
export function sessionVwap(bars: Bar[]): number[] {
  const out: number[] = new Array(bars.length);
  let dateKey = "";
  let cumPV = 0,
    cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = nyDateKey(b.time);
    if (d !== dateKey) {
      dateKey = d;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (b.high + b.low + b.close) / 3;
    const vol = b.volume && b.volume > 0 ? b.volume : 1;
    cumPV += typical * vol;
    cumV += vol;
    out[i] = cumPV / cumV;
  }
  return out;
}
