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

/* GLOBEX REOPEN — the boundary between one trading day and the next.
   Futures roll at 18:00 ET, not at midnight: bars printed on Sunday evening
   belong to Monday's session, and Monday 20:00 ET belongs to Tuesday. */
export const GLOBEX_REOPEN_MIN = 18 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

/* The NY date one weekday after `dateKey`. Plain UTC date arithmetic on a bare
   calendar date, so it is unaffected by DST. */
function nextWeekdayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  let cursor = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 5; i++) {
    cursor += 86400_000;
    const nxt = new Date(cursor);
    const wd = nxt.getUTCDay();
    if (wd !== 0 && wd !== 6)
      return `${nxt.getUTCFullYear()}-${pad(nxt.getUTCMonth() + 1)}-${pad(nxt.getUTCDate())}`;
  }
  const nxt = new Date(cursor);
  return `${nxt.getUTCFullYear()}-${pad(nxt.getUTCMonth() + 1)}-${pad(nxt.getUTCDate())}`;
}

/* The TRADING day a moment belongs to, as opposed to its calendar NY date.

   Identical to `nyDateKey` for every moment before 18:00 ET, which is every
   moment an entry can be taken (the strategies gate entries to 02:00-15:25 ET)
   — so this is a no-op on signal timestamps and cannot move an existing row.
   It matters for "now": once the engine runs during the Globex evening, a run
   at 20:00 ET Sunday is working on MONDAY's session, and keying its daily
   funnel to the calendar Sunday would file a zeroed row under a day that never
   traded and hide Friday's real one.

   Weekends roll to the next weekday; CME holidays deliberately do not, because
   the holiday check reads this key to decide whether to skip. */
export function tradingDayKey(time: number): string {
  const m = nyMeta(time);
  const weekend = m.weekday === "Sat" || m.weekday === "Sun";
  // A weekday before the 18:00 ET roll is its own trading day. Everything else
  // — the Globex evening, and all weekend — belongs to the next weekday.
  if (!weekend && m.minutes < GLOBEX_REOPEN_MIN) return m.dateKey;
  return nextWeekdayKey(m.dateKey);
}

/* 'HH:MM' in New York — for timeline/journal views that must render ET
   regardless of the browser's local timezone. */
export function nyClock(time: number): string {
  const m = nyMeta(time);
  return `${String(m.hour).padStart(2, "0")}:${String(m.minute).padStart(2, "0")}`;
}

/* Convert a New-York wall time (dateKey 'YYYY-MM-DD' + minutes since NY
   midnight) to unix seconds. Tries the EDT then EST offset and keeps the
   guess that round-trips through nyMeta, so it is exact across DST without
   ever touching the browser's local timezone (journal entries typed as ET
   from any timezone must land on the right bar). */
export function nyTimeToUnix(dateKey: string, minutes: number): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) / 1000 + minutes * 60;
  for (const offsetHours of [4, 5]) {
    const guess = base + offsetHours * 3600;
    const meta = nyMeta(guess);
    if (meta.dateKey === dateKey && meta.minutes === minutes) return guess;
  }
  // Non-existent wall time inside the spring-forward gap: use the EST guess.
  return base + 5 * 3600;
}
