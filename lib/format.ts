import { dateShortIn, dateTimeIn, type DisplayZone } from "./time/zones";

export function money(v: number, sign = true): string {
  const abs = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${abs}`;
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
