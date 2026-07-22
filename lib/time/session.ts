/* Session clock + ET display helpers shared by the Home dashboard and the
   Signals terminal: which phase the trading day is in, when the scheduled
   engine next wakes up, and how to render an ET timestamp. Times are unix
   seconds unless the name says iso. */

import { nyMeta } from "./ny";

export interface Phase {
  label: string;
  detail: string;
  live: boolean; // pulse the dot
  tone: "good" | "dim" | "warn";
}

export function marketPhase(nowSec: number): Phase {
  const m = nyMeta(nowSec);
  const weekend =
    m.weekday === "Sat" ||
    (m.weekday === "Sun" && m.minutes < 18 * 60) ||
    (m.weekday === "Fri" && m.minutes >= 17 * 60);
  if (weekend)
    return {
      label: "Market closed",
      detail: "Globex reopens Sunday 18:00 ET",
      live: false,
      tone: "dim",
    };
  if (m.minutes >= 17 * 60 && m.minutes < 18 * 60)
    return { label: "Daily break", detail: "Globex reopens 18:00 ET", live: false, tone: "dim" };
  if (m.weekday !== "Sun" && m.minutes >= 120 && m.minutes < 925)
    return {
      label: "Market open",
      detail: "London + New York · flat by 15:25 ET",
      live: true,
      tone: "good",
    };
  return {
    label: "Overnight session",
    detail: "Zones keep updating — entries resume 02:00 ET",
    live: true,
    tone: "warn",
  };
}

/* Next engine pass: cron every 15 min, 06:00-21:59 UTC, Mon-Fri. */
export function nextRunSec(nowSec: number): number {
  let t = Math.ceil((nowSec + 1) / 900) * 900;
  for (let i = 0; i < 4 * 24 * 8; i++, t += 900) {
    const d = new Date(t * 1000);
    const dow = d.getUTCDay();
    const h = d.getUTCHours();
    if (dow >= 1 && dow <= 5 && h >= 6 && h < 22) return t;
  }
  return t;
}

export function fmtCountdown(sec: number): string {
  if (sec >= 48 * 3600) return `${Math.round(sec / 86400)}d`;
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/* Position of "now" on the 02:00 → 15:25 ET entry tape, or null on weekends. */
export function tapeProgress(nowSec: number): number | null {
  const m = nyMeta(nowSec);
  if (m.weekday === "Sat" || m.weekday === "Sun") return null;
  return Math.max(0, Math.min(1, (m.minutes - 120) / (925 - 120)));
}

const nyDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const nyDayLong = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "short",
  day: "numeric",
});

/** "Tue, Jul 21" in New York. */
export function dayLabel(date: Date): string {
  return nyDay.format(date);
}

/** "Tuesday, Jul 21" in New York. */
export function dayLabelLong(date: Date): string {
  return nyDayLong.format(date);
}

/** "13:20" in ET, or "—" when there is no timestamp. */
export function fmtEt(isoOrNull: string | null): string {
  if (!isoOrNull) return "—";
  const m = nyMeta(Math.floor(new Date(isoOrNull).getTime() / 1000));
  return `${String(m.hour).padStart(2, "0")}:${String(m.minute).padStart(2, "0")}`;
}

/** "Tue, Jul 21, 13:20 ET". */
export function fmtEtFull(isoOrNull: string | null): string {
  if (!isoOrNull) return "—";
  return `${dayLabel(new Date(isoOrNull))}, ${fmtEt(isoOrNull)} ET`;
}

/** Relative age of an ISO timestamp: "just now", "12 min ago", "3h 4m ago". */
export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}
