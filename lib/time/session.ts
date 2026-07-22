/* Session clock + timestamp display helpers shared by the Home dashboard and
   the Signals terminal: which phase the trading day is in, when the scheduled
   engine next wakes up, and how to render a moment in the zone the reader
   picked (see components/providers/ZoneProvider).

   Session boundaries are ET rules, so they always print both clocks —
   "flat by 15:25 ET (00:55 IST)". Timestamps follow the reader's choice.
   Times are unix seconds unless the name says iso. */

import { nyMeta } from "./ny";
import { clockIn, dayIn, dayLongIn, etTimeLabel, ZONE_ABBR, type DisplayZone } from "./zones";

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
      detail: `Globex reopens Sunday ${etTimeLabel("18:00")}`,
      live: false,
      tone: "dim",
    };
  if (m.minutes >= 17 * 60 && m.minutes < 18 * 60)
    return {
      label: "Daily break",
      detail: `Globex reopens ${etTimeLabel("18:00")}`,
      live: false,
      tone: "dim",
    };
  if (m.weekday !== "Sun" && m.minutes >= 120 && m.minutes < 925)
    return {
      label: "Market open",
      detail: `London + New York · flat by ${etTimeLabel("15:25")}`,
      live: true,
      tone: "good",
    };
  return {
    label: "Overnight session",
    detail: `Zones keep updating — entries resume ${etTimeLabel("02:00")}`,
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

/* ── Timestamp display ───────────────────────────────────────────────────
   All four take the reader's zone. The *grouping* of signals into trading
   days stays on New York dates (lib/time/ny.ts) — only the rendering moves. */

/** "Tue, Jul 21" in the reader's zone. */
export function dayLabel(date: Date, zone: DisplayZone): string {
  return dayIn(Math.floor(date.getTime() / 1000), zone);
}

/** "Tuesday, Jul 21" in the reader's zone. */
export function dayLabelLong(date: Date, zone: DisplayZone): string {
  return dayLongIn(Math.floor(date.getTime() / 1000), zone);
}

/** "22:50" in the reader's zone, or "—" when there is no timestamp. */
export function fmtTime(isoOrNull: string | null, zone: DisplayZone): string {
  if (!isoOrNull) return "—";
  return clockIn(Math.floor(new Date(isoOrNull).getTime() / 1000), zone);
}

/** "Tue, Jul 21, 22:50 IST" — a stamp that stands alone. */
export function fmtStamp(isoOrNull: string | null, zone: DisplayZone): string {
  if (!isoOrNull) return "—";
  const sec = Math.floor(new Date(isoOrNull).getTime() / 1000);
  return `${dayIn(sec, zone)}, ${clockIn(sec, zone)} ${ZONE_ABBR[zone]}`;
}

/** Relative age of an ISO timestamp: "just now", "12 min ago", "3h 4m ago". */
export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}
