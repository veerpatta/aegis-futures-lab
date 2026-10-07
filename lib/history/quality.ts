/* Bar quality for one (symbol, chunk) read. Pure.

   Checks OHLC consistency, ordering, duplicates, gaps inside the trading day
   and price discontinuities (unadjusted contract-roll jumps, bad prints).
   Nothing is repaired: flagged windows quarantine the ideas that touch them,
   and the counts go into the study's manifest. */

import type { Bar } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { earlyCloseMinuteNy, isMarketHoliday } from "@/lib/market/holidays";
import { HIST_RULES } from "./rules";

export interface FlaggedWindow {
  from: number;
  to: number;
  kind: "gap" | "discontinuity" | "ohlc";
  detail: string;
}

export interface QualityReport {
  bars: number;
  ohlcBad: number;
  duplicates: number;
  unordered: number;
  gaps: number;
  missingBars: number;
  discontinuities: number;
  windows: FlaggedWindow[];
}

const BAR = 300;

/** Minutes of the New York day the futures market trades (Globex: 18:00 → 17:00, daily break 17:00–18:00). */
function tradingMinute(t: number): boolean {
  const m = nyMeta(t);
  if (m.weekday === "Sat") return false;
  if (m.weekday === "Sun" && m.minutes < 18 * 60) return false;
  if (m.weekday === "Fri" && m.minutes >= 17 * 60) return false;
  if (m.minutes >= 17 * 60 && m.minutes < 18 * 60) return false;
  const early = earlyCloseMinuteNy(m.dateKey);
  if (early !== null && m.minutes >= early && m.minutes < 18 * 60) return false;
  return !isMarketHoliday(m.dateKey);
}

export function checkBars(bars: Bar[], symbol: string, rules = HIST_RULES): { clean: Bar[]; report: QualityReport } {
  const windows: FlaggedWindow[] = [];
  let ohlcBad = 0, duplicates = 0, unordered = 0, gaps = 0, missingBars = 0, discontinuities = 0;
  const seen = new Set<number>();
  const clean: Bar[] = [];
  let prevTime = -Infinity;
  for (const b of bars) {
    if (seen.has(b.time)) { duplicates++; continue; }
    seen.add(b.time);
    if (b.time < prevTime) unordered++;
    prevTime = Math.max(prevTime, b.time);
    const ok = [b.open, b.high, b.low, b.close].every(Number.isFinite) && b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.low > 0;
    if (!ok) {
      ohlcBad++;
      windows.push({ from: b.time, to: b.time + BAR, kind: "ohlc", detail: "inconsistent OHLC" });
      continue;
    }
    clean.push(b);
  }
  clean.sort((a, b) => a.time - b.time);

  // Rolling true range for the discontinuity threshold.
  const trs: number[] = [];
  const minPts = rules.quality.discontinuityMinPoints[symbol] ?? 8;
  for (let i = 1; i < clean.length; i++) {
    const p = clean[i - 1], b = clean[i];
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    const recent = trs.slice(-14);
    const atr = recent.length ? recent.reduce((a, v) => a + v, 0) / recent.length : tr;
    const jump = Math.abs(b.open - p.close);
    if (recent.length >= 14 && jump > Math.max(rules.quality.discontinuityAtr * atr, minPts)) {
      discontinuities++;
      windows.push({ from: p.time, to: b.time + BAR, kind: "discontinuity", detail: `${jump.toFixed(2)} pt jump` });
    }
    trs.push(Math.min(tr, Math.max(atr * 4, minPts)));
    // Gaps: missing bars between two bars, counting only minutes the market trades.
    if (b.time - p.time > BAR) {
      let missing = 0;
      for (let t = p.time + BAR; t < b.time; t += BAR) if (tradingMinute(t)) missing++;
      if (missing >= rules.quality.gapMinMissingBars) {
        gaps++;
        missingBars += missing;
        windows.push({ from: p.time, to: b.time, kind: "gap", detail: `${missing} missing bars` });
      }
    }
  }
  return { clean, report: { bars: bars.length, ohlcBad, duplicates, unordered, gaps, missingBars, discontinuities, windows } };
}

/** True when [from, to] touches any flagged window. */
export function touchesFlag(windows: FlaggedWindow[], from: number, to: number): FlaggedWindow | null {
  for (const w of windows) if (w.from <= to && w.to >= from) return w;
  return null;
}
