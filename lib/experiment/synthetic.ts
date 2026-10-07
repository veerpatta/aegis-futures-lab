/* Synthetic mode: generated prices and a trivial registered setup, so the whole
   loop — decide, fill, exit, learn, evaluate, adopt or reject — can be proven
   end to end at zero data cost.

   Everything here is labelled synthetic wherever it appears. Its outcomes can
   never qualify a market strategy or count as real-market improvement, and its
   bars are generated in memory — never written to bars_5m. The setup lives
   here, not in lib/strategies, so it can never become a trade idea. */

import type { Bar } from "@/lib/types";
import { mulberry32 } from "@/scripts/engine/montecarlo";
import { nyMeta, nyTimeToUnix, tradingDayKey } from "@/lib/time/ny";
import { isMarketHoliday } from "@/lib/market/holidays";
import type { ExpSymbol, Opportunity } from "./types";

export const SYN_SETUP = "syn-breakout-v0";
const BAR_SEC = 300;

function dayBars(seed: number, symbol: ExpSymbol, dateKey: string): Bar[] {
  const rand = mulberry32((seed ^ (symbol === "MES" ? 0x5e5 : 0x7a7) ^ Number(dateKey.replaceAll("-", ""))) >>> 0);
  const tick = 0.25;
  const vol = symbol === "MES" ? 1.6 : 7;
  let price = Math.round(((symbol === "MES" ? 5800 : 20500) * (1 + (rand() - 0.5) * 0.04)) / tick) * tick;
  const regime = rand() < 0.5 ? -1 : 1;
  const bars: Bar[] = [];
  for (let minutes = 120; minutes < 17 * 60; minutes += 5) {
    const t = nyTimeToUnix(dateKey, minutes);
    const drift = regime * vol * 0.08;
    const move = (rand() + rand() + rand() - 1.5) * vol + drift;
    const open = price;
    const close = Math.round((open + move) / tick) * tick;
    const high = Math.max(open, close) + Math.round((rand() * vol * 0.6) / tick) * tick;
    const low = Math.min(open, close) - Math.round((rand() * vol * 0.6) / tick) * tick;
    bars.push({ time: t, open, high, low, close, volume: 500 + Math.floor(rand() * 1500) });
    price = close;
  }
  return bars;
}

/** Deterministic 5-minute bars, Monday–Friday 02:00–16:55 New York time. Each
    day depends only on (seed, symbol, date), so any window reproduces exactly. */
export function syntheticBars(seed: number, symbol: ExpSymbol, fromSec: number, toSec: number): Bar[] {
  const out: Bar[] = [];
  const seen = new Set<string>();
  for (let t = fromSec - 86400; t < toSec + 86400; t += 3600) {
    const m = nyMeta(t);
    if (seen.has(m.dateKey)) continue;
    seen.add(m.dateKey);
    if (m.weekday === "Sat" || m.weekday === "Sun" || isMarketHoliday(m.dateKey)) continue;
    for (const b of dayBars(seed, symbol, m.dateKey)) if (b.time >= fromSec && b.time < toSec) out.push(b);
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The synthetic setup: a 12-bar breakout between 10:00 and 15:00 New York
    time, stop 1.5 × the recent average range away, target 2R. At most two a
    day per symbol. Emitted the bar after it forms, like a real idea. */
export function syntheticOpportunities(bars: Bar[], symbol: ExpSymbol): Opportunity[] {
  const out: Opportunity[] = [];
  const perDay = new Map<string, number>();
  // Only days whose first bar (02:00) is in the window, so the same day always
  // yields the same ideas whatever window a batch happens to read.
  const complete = new Set(bars.filter((b) => nyMeta(b.time).minutes === 120).map((b) => tradingDayKey(b.time)));
  for (let i = 12; i < bars.length - 1; i++) {
    const b = bars[i];
    const m = nyMeta(b.time);
    if (m.minutes < 600 || m.minutes >= 900) continue;
    const day = tradingDayKey(b.time);
    if (!complete.has(day)) continue;
    if ((perDay.get(day) ?? 0) >= 2) continue;
    const window = bars.slice(i - 12, i);
    if (window[0].time !== b.time - 12 * BAR_SEC) continue;
    const hi = Math.max(...window.map((x) => x.high)), lo = Math.min(...window.map((x) => x.low));
    const range = window.reduce((a, x) => a + (x.high - x.low), 0) / window.length;
    const side = b.close > hi ? "LONG" : b.close < lo ? "SHORT" : null;
    if (!side) continue;
    const entry = b.close;
    const risk = Math.max(2.5, Math.round((1.5 * range) / 0.25) * 0.25);
    const stop = side === "LONG" ? entry - risk : entry + risk;
    const target = side === "LONG" ? entry + 2 * risk : entry - 2 * risk;
    const signalTs = bars[i + 1].time;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    out.push({
      key: `syn:${SYN_SETUP}:${symbol}:${signalTs}`, signalId: null, symbol, side, entry, stop, target,
      signalTs, seenAt: signalTs + BAR_SEC, exitTs: null, strategy: SYN_SETUP, tier: "A",
      regime: Math.abs(b.close - window[0].open) > 3 * range ? "trend-high-vol" : "range-low-vol",
      vixBucket: "low", score: Math.round(((b.close - (side === "LONG" ? hi : lo)) / range) * 100) / 100, rr: 2,
    });
  }
  return out;
}

/** Unix seconds of a New York date-time, for building synthetic clocks. */
export const nyAt = (dateKey: string, minutes: number) => nyTimeToUnix(dateKey, minutes);
