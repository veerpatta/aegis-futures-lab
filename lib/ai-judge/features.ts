/* Market context for the AI second opinion (feature version ai-judge-features-v1).

   Point-in-time by construction: marketContext() itself drops every bar that
   had not ENDED by the decision's information cutoff, whatever the caller
   passes, so a later bar can never leak into a prompt. Bars are the delayed
   5-minute bars the learner simulates on (bars_5m, source yahoo); `time` is
   the bar's open in unix seconds.

   "Today" is the New York trading day of the cutoff (tradingDayKey): the
   Globex evening before belongs to it, as everywhere else in the app. */

import { atr, ema, rsi } from "@/lib/indicators";
import { NY_FLAT_BY_MIN, nyClock, nyMeta, nyTimeToUnix, tradingDayKey } from "@/lib/time/ny";

export const BAR_SECONDS = 300;
/** How far back the caller should load bars: enough for the 1-hour trend and
    the prior session's close across a weekend. */
export const CONTEXT_LOOKBACK_SECONDS = 4 * 86400;

export interface JudgeBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketContext {
  barsUsed: number;
  lastBarEnd: number | null;
  lastClose: number | null;
  /** Since today's first bar (the Globex reopen). */
  changeTodayPct: number | null;
  /** Against the last close of the previous trading day. */
  priorCloseDistancePct: number | null;
  last15mPct: number | null;
  last1hPct: number | null;
  last4hPct: number | null;
  atr14Points: number | null;
  stopDistanceAtr: number | null;
  rsi14: number | null;
  /** 0 = at today's low, 1 = at today's high. */
  dayRangePosition: number | null;
  trend1h: "up" | "down" | "flat" | null;
}

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
const pct = (now: number, then: number | null) => (then && then > 0 ? round(((now - then) / then) * 100, 2) : null);

function validBar(b: JudgeBar): boolean {
  return [b.time, b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n)) && b.low > 0 && b.high >= b.low && Number.isSafeInteger(b.time);
}

/** Close of the latest bar that ended at or before `endSec`, if it ended no
    more than `toleranceSec` before it (a gap is not a price). */
function closeEndingBy(bars: JudgeBar[], endSec: number, toleranceSec: number): number | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    const end = bars[i].time + BAR_SECONDS;
    if (end <= endSec) return endSec - end <= toleranceSec ? bars[i].close : null;
  }
  return null;
}

export function marketContext(input: { bars: readonly JudgeBar[]; cutoffSec: number; entry: number; stop: number }): MarketContext {
  // Point-in-time guard: only bars that had ended by the cutoff, one per time.
  const byTime = new Map<number, JudgeBar>();
  for (const b of input.bars) if (validBar(b) && b.time + BAR_SECONDS <= input.cutoffSec) byTime.set(b.time, b);
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  const empty: MarketContext = {
    barsUsed: 0, lastBarEnd: null, lastClose: null, changeTodayPct: null, priorCloseDistancePct: null, last15mPct: null,
    last1hPct: null, last4hPct: null, atr14Points: null, stopDistanceAtr: null, rsi14: null, dayRangePosition: null, trend1h: null,
  };
  if (!bars.length) return empty;
  const last = bars[bars.length - 1];
  const lastEnd = last.time + BAR_SECONDS;
  const lastClose = last.close;

  const today = tradingDayKey(input.cutoffSec - 1);
  const todays = bars.filter((b) => tradingDayKey(b.time) === today);
  const earlier = bars.filter((b) => tradingDayKey(b.time) < today);
  const priorClose = earlier.length ? earlier[earlier.length - 1].close : null;
  const todayOpen = todays.length ? todays[0].open : null;
  const dayHigh = todays.length ? Math.max(...todays.map((b) => b.high)) : null;
  const dayLow = todays.length ? Math.min(...todays.map((b) => b.low)) : null;

  const atrSeries = atr(bars, 14);
  const atrNow = atrSeries[atrSeries.length - 1];
  const rsiSeries = rsi(bars.map((b) => b.close), 14);
  const rsiNow = rsiSeries[rsiSeries.length - 1];

  // Hourly closes sampled back from the last bar, then a 10-hour EMA slope.
  const hourly: number[] = [];
  for (let i = bars.length - 1; i >= 0 && hourly.length < 30; i -= 12) hourly.unshift(bars[i].close);
  const hourlyEma = hourly.length >= 12 ? ema(hourly, 10) : [];
  const e1 = hourlyEma[hourlyEma.length - 1], e0 = hourlyEma[hourlyEma.length - 2];
  let trend1h: MarketContext["trend1h"] = null;
  if (typeof e1 === "number" && typeof e0 === "number") {
    const slopePct = ((e1 - e0) / e0) * 100;
    trend1h = slopePct > 0.03 ? "up" : slopePct < -0.03 ? "down" : "flat";
  }

  const tolerance = 10 * 60;
  return {
    barsUsed: bars.length,
    lastBarEnd: lastEnd,
    lastClose,
    changeTodayPct: pct(lastClose, todayOpen),
    priorCloseDistancePct: pct(lastClose, priorClose),
    last15mPct: pct(lastClose, closeEndingBy(bars, lastEnd - 15 * 60, tolerance)),
    last1hPct: pct(lastClose, closeEndingBy(bars, lastEnd - 3600, tolerance)),
    last4hPct: pct(lastClose, closeEndingBy(bars, lastEnd - 4 * 3600, tolerance)),
    atr14Points: typeof atrNow === "number" ? round(atrNow, 2) : null,
    stopDistanceAtr: typeof atrNow === "number" && atrNow > 0 ? round(Math.abs(input.entry - input.stop) / atrNow, 2) : null,
    rsi14: typeof rsiNow === "number" ? round(rsiNow, 1) : null,
    dayRangePosition: dayHigh !== null && dayLow !== null && dayHigh > dayLow ? round((lastClose - dayLow) / (dayHigh - dayLow), 2) : null,
    trend1h,
  };
}

/** "Fri 10:10" in New York, and minutes left before the bot must be flat. */
export function sessionClock(cutoffSec: number): { newYork: string; minutesUntilFlat: number } {
  const meta = nyMeta(cutoffSec);
  const flatAt = nyTimeToUnix(tradingDayKey(cutoffSec - 1), NY_FLAT_BY_MIN);
  return { newYork: `${meta.weekday} ${nyClock(cutoffSec)}`, minutesUntilFlat: Math.max(0, Math.round((flatAt - cutoffSec) / 60)) };
}
