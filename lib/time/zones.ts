/* Display timezones.
 *
 * The strategy, the engine and every stored timestamp are anchored to New York
 * exchange time — that never changes, and neither does the day-grouping in the
 * blotter or the journal's ET wall-clock input. What changes here is purely how
 * a moment is *shown*: a trader in India reads the same signal as 22:50 IST.
 *
 * India has no DST but the US does, so the ET↔IST gap is 9h30m from March to
 * November and 10h30m the rest of the year. Nothing below hardcodes the gap —
 * every conversion goes through the IANA zone, so it stays right year-round.
 */

import { nyMeta, nyTimeToUnix } from "./ny";

export type DisplayZone = "ET" | "IST";

export const DISPLAY_ZONES: DisplayZone[] = ["ET", "IST"];

const IANA: Record<DisplayZone, string> = {
  ET: "America/New_York",
  IST: "Asia/Kolkata",
};

/** What the zone is called on screen. Always render this next to a time. */
export const ZONE_ABBR: Record<DisplayZone, string> = { ET: "ET", IST: "IST" };

export const ZONE_NAME: Record<DisplayZone, string> = {
  ET: "New York (ET)",
  IST: "India (IST)",
};

/* Intl formatters are expensive to build; one per zone per shape. */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: DisplayZone, key: string, opts: Intl.DateTimeFormatOptions) {
  const id = `${zone}:${key}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: IANA[zone], ...opts });
    cache.set(id, f);
  }
  return f;
}

const part = (f: Intl.DateTimeFormat, d: Date, type: string) =>
  f.formatToParts(d).find((p) => p.type === type)?.value ?? "";

/** "22:50" — 24-hour clock in the display zone. */
export function clockIn(sec: number, zone: DisplayZone): string {
  const f = formatter(zone, "clock", { hour: "2-digit", minute: "2-digit", hour12: false });
  const d = new Date(sec * 1000);
  // hourCycle h23 keeps midnight as "00", not "24".
  return `${part(f, d, "hour").replace(/^24$/, "00")}:${part(f, d, "minute")}`;
}

/** "Tue, Jul 21" in the display zone. */
export function dayIn(sec: number, zone: DisplayZone): string {
  return formatter(zone, "day", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(sec * 1000));
}

/** "Tuesday, Jul 21" in the display zone. */
export function dayLongIn(sec: number, zone: DisplayZone): string {
  return formatter(zone, "dayLong", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(sec * 1000));
}

/** "Jul 21" in the display zone. */
export function dateShortIn(sec: number, zone: DisplayZone): string {
  return formatter(zone, "dateShort", { month: "short", day: "numeric" }).format(
    new Date(sec * 1000)
  );
}

/** "Jul 21, 22:50" — compact stamp for dense tables (zone label sits in the header). */
export function dateTimeIn(sec: number, zone: DisplayZone): string {
  return `${dateShortIn(sec, zone)}, ${clockIn(sec, zone)}`;
}

/** "Tue, Jul 21, 22:50 IST" — a stamp that stands alone. */
export function stampIn(sec: number, zone: DisplayZone): string {
  return `${dayIn(sec, zone)}, ${clockIn(sec, zone)} ${ZONE_ABBR[zone]}`;
}

const dayKeyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * "2026-07-21" → "Tue, Jul 21". Takes a New York dateKey and is deliberately
 * NOT zone-aware: this names a *trading day*, which is a New York calendar
 * date no matter which clock the reader is on. Rendering it in IST would slide
 * an evening session onto the following date.
 */
export function dayKeyLabel(key: string, opts?: { weekday?: boolean }): string {
  const label = dayKeyFmt.format(new Date(`${key}T12:00:00Z`));
  return opts?.weekday === false ? label.replace(/^\w+,\s*/, "") : label;
}

/** Hour of day (0–23) in the display zone. */
export function hourIn(sec: number, zone: DisplayZone): number {
  return Number(
    part(
      formatter(zone, "clock", { hour: "2-digit", minute: "2-digit", hour12: false }),
      new Date(sec * 1000),
      "hour"
    )
  ) % 24;
}

/* ── Fixed ET session windows ────────────────────────────────────────────
   The strategy's rules are written in ET wall clock ("flat by 15:25"). Those
   are not timestamps, so they can't just be reformatted — they're converted
   through the DST state in effect *right now*, which is why these read
   00:55 IST in July and 01:55 IST in December. */

const etWallCache = new Map<string, string>();

/** "15:25" ET → "00:55" in `zone`, using today's DST state. */
export function etWallIn(hhmm: string, zone: DisplayZone, refSec?: number): string {
  if (zone === "ET") return hhmm;
  const now = refSec ?? Math.floor(Date.now() / 1000);
  const dateKey = nyMeta(now).dateKey;
  const id = `${zone}:${dateKey}:${hhmm}`;
  const hit = etWallCache.get(id);
  if (hit) return hit;
  const [h, m] = hhmm.split(":").map(Number);
  const out = clockIn(nyTimeToUnix(dateKey, h * 60 + m), zone);
  if (etWallCache.size > 500) etWallCache.clear();
  etWallCache.set(id, out);
  return out;
}

/**
 * "15:25 ET (00:55 IST)" — a single session boundary, both zones.
 * These always show both: the ET figure is the rule, the IST figure is when
 * that rule lands on an Indian clock.
 */
export function etTimeLabel(hhmm: string): string {
  return `${hhmm} ET (${etWallIn(hhmm, "IST")} IST)`;
}

/** "02:00–15:25 ET (11:30–00:55 IST)" — a session window, both zones. */
export function etWindowLabel(from: string, to: string, dash = "–"): string {
  return `${from}${dash}${to} ET (${etWallIn(from, "IST")}${dash}${etWallIn(to, "IST")} IST)`;
}

/** Current gap, e.g. "IST is 9h30m ahead of ET". Used in the Guide. */
export function zoneGapNote(refSec?: number): string {
  const now = refSec ?? Math.floor(Date.now() / 1000);
  const d = new Date(now * 1000);
  const minutes =
    (offsetMinutes(d, IANA.IST) - offsetMinutes(d, IANA.ET) + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `IST is ${h}h${m ? `${String(m).padStart(2, "0")}m` : ""} ahead of ET`;
}

/* Minutes east of UTC for an IANA zone at a given instant. */
function offsetMinutes(d: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const name = f.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
