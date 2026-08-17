import { dateShortIn, dateTimeIn, type DisplayZone } from "./time/zones";

export function money(v: number, sign = true): string {
  const abs = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${abs}`;
}

/* An index-point move, which is NOT money and must never be formatted as it.
   /markets rendered `price - previousClose` through money(), so a 24.5-point
   MES move printed "+$24.50" — the real figure on one contract is $122.50
   (POINT_VALUES.MES = 5), and on the 4–12 the engine actually sizes it is
   five to twelve times that again. The percentage beside it was correct all
   along, which is what made the dollar figure look authoritative.

   Points are the honest unit here: the dollar value of a move depends on how
   many contracts you hold, and the quote does not know that. */
export function points(v: number, sign = true): string {
  const abs = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}${abs} pts`;
}

export function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function ratio(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(2);
}

/* Timestamps render in the zone the reader picked (ET or IST), never in the
   browser's own timezone — a backtest row and a live signal must be readable
   against the same clock. See lib/time/zones.ts. */

export function ts(sec: number, zone: DisplayZone): string {
  return dateTimeIn(sec, zone);
}

export function dateOnly(sec: number, zone: DisplayZone): string {
  return dateShortIn(sec, zone);
}
