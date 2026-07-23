/* CME equity-futures holiday calendar (2026–2027), keyed by the NY-session
   date (nyMeta().dateKey). Data lives in cme-holidays.json so the plain-node
   watchdog (scripts/engine/watchdog.mjs) can read the same table without a
   TypeScript toolchain. Dates verified against the official CME/NYSE
   calendars on 2026-07-23 — CME finalizes hours ~2 weeks ahead, so re-check
   near each holiday and extend the table when 2028 is published. */

import raw from "./cme-holidays.json";

export interface MarketHoliday {
  date: string; // "YYYY-MM-DD", NY calendar date
  kind: "closed" | "early-close";
  earlyCloseEt?: string; // "13:00" — NY wall clock, early-close days only
  name: string;
}

export const MARKET_HOLIDAYS: MarketHoliday[] = raw.holidays as MarketHoliday[];

const byDate = new Map<string, MarketHoliday>(MARKET_HOLIDAYS.map((h) => [h.date, h]));

export function holidayFor(dateKeyNy: string): MarketHoliday | null {
  return byDate.get(dateKeyNy) ?? null;
}

/** Full closure — no NY day session at all. */
export function isMarketHoliday(dateKeyNy: string): boolean {
  return byDate.get(dateKeyNy)?.kind === "closed";
}

/** Early-close halt in NY minutes (13:00 → 780), or null on normal days. */
export function earlyCloseMinuteNy(dateKeyNy: string): number | null {
  const h = byDate.get(dateKeyNy);
  if (!h || h.kind !== "early-close" || !h.earlyCloseEt) return null;
  const [hh, mm] = h.earlyCloseEt.split(":").map(Number);
  return hh * 60 + mm;
}

/* The minute simulated positions must be flat by: 5 minutes before an early
   close (mirroring the normal 15:25-before-15:30 buffer), else the normal
   session exit. */
export function flattenMinuteNy(dateKeyNy: string, normalExitMinute: number): number {
  const early = earlyCloseMinuteNy(dateKeyNy);
  return early === null ? normalExitMinute : Math.min(normalExitMinute, early - 5);
}
