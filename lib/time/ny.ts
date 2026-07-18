/* New York session helpers shared by the API routes, the zone engine and
   the backtest simulator. Session: 09:30–15:30 America/New_York, weekdays.
   Times are unix seconds throughout. */

export interface NyMeta {
  weekday: string; // 'Mon'…'Sun'
  minutes: number; // minutes since NY midnight
  dateKey: string; // 'YYYY-MM-DD' in New York
  hour: number;
  minute: number;
}

export const NY_SESSION_START_MIN = 570; // 09:30
export const NY_SESSION_END_MIN = 930; // 15:30 (exclusive)
export const NY_FLAT_BY_MIN = 925; // force-flat threshold, 15:25

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const metaCache = new Map<number, NyMeta>();

export function nyMeta(time: number): NyMeta {
  const cached = metaCache.get(time);
  if (cached) return cached;
  const parts = fmt
    .formatToParts(new Date(time * 1000))
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const meta: NyMeta = {
    weekday: parts.weekday,
    minutes: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
  };
  if (metaCache.size > 200000) metaCache.clear();
  metaCache.set(time, meta);
  return meta;
}

export function isWeekend(time: number): boolean {
  const { weekday } = nyMeta(time);
  return weekday === "Sat" || weekday === "Sun";
}

export function inNySession(time: number): boolean {
  const meta = nyMeta(time);
  return (
    meta.weekday !== "Sat" &&
    meta.weekday !== "Sun" &&
    meta.minutes >= NY_SESSION_START_MIN &&
    meta.minutes < NY_SESSION_END_MIN
  );
}

export function nyDateKey(time: number): string {
  return nyMeta(time).dateKey;
}
