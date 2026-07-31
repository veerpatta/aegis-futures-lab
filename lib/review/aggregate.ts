/* Post-trade review aggregation.
   ─────────────────────────────────────────────────────────────────────────
   Everything on the Review page is derived here, so the page renders and does
   not compute. All of it works off SignalRow's closed rows and routes through
   the shared definitions in lib/stats.ts rather than re-deriving a win rate or
   an expectancy locally (rule 4). */

import { nyMeta } from "@/lib/time/ny";
import { expectancy, profitFactor, rateFromPnls, type RateReadout } from "@/lib/stats";

/** The subset of a signal row the review actually needs. */
export interface ReviewRow {
  signal_ts: string;
  exit_ts: string | null;
  pnl_usd: number | null;
  symbol: string;
  tier: string | null;
  regime: string | null;
  suppressed?: boolean;
  stale_data?: boolean;
}

/* A day's worth of closed trades. `dateKey` is the NY trading date, which is
   what a trader means by "that day" — not the UTC calendar date. */
export interface DayCell {
  dateKey: string;
  net: number;
  trades: number;
  wins: number;
}

/** Only rows that finished and count toward headline performance. */
export function closedRows(rows: ReviewRow[]): ReviewRow[] {
  return rows.filter((r) => r.pnl_usd !== null && !r.suppressed && !r.stale_data);
}

/* Group by the NY date the trade CLOSED on, falling back to its signal time.
   A trade opened at 15:20 and closed at 15:25 belongs to that session either
   way; the fallback only matters for rows whose exit never got stamped. */
export function dailyPnl(rows: ReviewRow[]): DayCell[] {
  const byDay = new Map<string, DayCell>();
  for (const r of closedRows(rows)) {
    const sec = Math.floor(new Date(r.exit_ts ?? r.signal_ts).getTime() / 1000);
    const dateKey = nyMeta(sec).dateKey;
    const cell = byDay.get(dateKey) ?? { dateKey, net: 0, trades: 0, wins: 0 };
    cell.net += r.pnl_usd ?? 0;
    cell.trades += 1;
    if ((r.pnl_usd ?? 0) > 0) cell.wins += 1;
    byDay.set(dateKey, cell);
  }
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/* ── Calendar ─────────────────────────────────────────────────────────────
   A month grid, Monday-first because a trading week is Mon–Fri and starting
   on Sunday puts a dead column at the front. Leading/trailing blanks pad the
   grid so weekday columns line up. */

export interface CalendarCell {
  dateKey: string | null; // null = padding
  net: number | null;
  trades: number;
  inMonth: boolean;
}

/** `month` is "YYYY-MM". */
export function monthCalendar(days: DayCell[], month: string): CalendarCell[] {
  const byKey = new Map(days.map((d) => [d.dateKey, d]));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay: 0=Sun … 6=Sat. Monday-first index: Mon=0 … Sun=6.
  const lead = (first.getUTCDay() + 6) % 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++)
    cells.push({ dateKey: null, net: null, trades: 0, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${month}-${String(d).padStart(2, "0")}`;
    const hit = byKey.get(dateKey);
    cells.push({
      dateKey,
      net: hit ? hit.net : null,
      trades: hit?.trades ?? 0,
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0)
    cells.push({ dateKey: null, net: null, trades: 0, inMonth: false });
  return cells;
}

/** Months present in the data, newest first, as "YYYY-MM". */
export function monthsWithData(days: DayCell[]): string[] {
  return [...new Set(days.map((d) => d.dateKey.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
}

/* ── Year heatmap ─────────────────────────────────────────────────────────
   GitHub-style: one column per ISO week, one row per weekday. Weekends are
   dropped entirely rather than rendered empty — the market is shut and two
   permanently blank rows is just noise. */

export interface HeatCell {
  dateKey: string;
  net: number | null;
  trades: number;
  weekIndex: number;
  /** 0 = Monday … 4 = Friday. */
  weekday: number;
}

export function yearHeatmap(days: DayCell[], endDateKey: string, weeks = 53): HeatCell[] {
  const byKey = new Map(days.map((d) => [d.dateKey, d]));
  const end = new Date(`${endDateKey}T00:00:00Z`);
  // Walk back to the Monday of the final week so columns are whole weeks.
  const endMonday = new Date(end);
  endMonday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  const start = new Date(endMonday);
  start.setUTCDate(endMonday.getUTCDate() - (weeks - 1) * 7);

  const cells: HeatCell[] = [];
  for (let w = 0; w < weeks; w++)
    for (let d = 0; d < 5; d++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + w * 7 + d);
      if (day > end) continue;
      const dateKey = day.toISOString().slice(0, 10);
      const hit = byKey.get(dateKey);
      cells.push({
        dateKey,
        net: hit ? hit.net : null,
        trades: hit?.trades ?? 0,
        weekIndex: w,
        weekday: d,
      });
    }
  return cells;
}

/* ── Session analytics ────────────────────────────────────────────────────
   The audit's "NY open / lunch / close, RTH vs ETH" split. Boundaries are NY
   minutes and deliberately match the session language the rest of the app
   already uses. */

export interface SessionBucket {
  key: string;
  label: string;
  fromMin: number;
  toMin: number;
}

export const SESSIONS: SessionBucket[] = [
  { key: "overnight", label: "Overnight / Asia", fromMin: 0, toMin: 120 },
  { key: "london", label: "London", fromMin: 120, toMin: 570 },
  { key: "nyOpen", label: "NY open (09:30–11:00)", fromMin: 570, toMin: 660 },
  { key: "lunch", label: "Lunch (11:00–13:30)", fromMin: 660, toMin: 810 },
  { key: "nyClose", label: "NY close (13:30–15:25)", fromMin: 810, toMin: 925 },
  { key: "late", label: "After the flat", fromMin: 925, toMin: 1440 },
];

export function sessionOf(entrySec: number): SessionBucket {
  const mins = nyMeta(entrySec).minutes;
  return (
    SESSIONS.find((s) => mins >= s.fromMin && mins < s.toMin) ?? SESSIONS[SESSIONS.length - 1]
  );
}

export interface SliceStat {
  key: string;
  label: string;
  net: number;
  pf: number | null;
  expectancy: number | null;
  rate: RateReadout;
}

function statFor(key: string, label: string, pnls: number[]): SliceStat {
  return {
    key,
    label,
    net: pnls.reduce((a, v) => a + v, 0),
    pf: profitFactor(pnls),
    expectancy: expectancy(pnls),
    rate: rateFromPnls(pnls),
  };
}

/** Generic slicer over closed rows; every bucket carries its own n. */
export function sliceStats(
  rows: ReviewRow[],
  keyOf: (r: ReviewRow) => { key: string; label: string } | null
): SliceStat[] {
  const groups = new Map<string, { label: string; pnls: number[] }>();
  for (const r of closedRows(rows)) {
    const k = keyOf(r);
    if (!k) continue;
    const g = groups.get(k.key) ?? { label: k.label, pnls: [] };
    g.pnls.push(r.pnl_usd ?? 0);
    groups.set(k.key, g);
  }
  return [...groups.entries()].map(([key, g]) => statFor(key, g.label, g.pnls));
}

export function bySession(rows: ReviewRow[]): SliceStat[] {
  const stats = sliceStats(rows, (r) => {
    const s = sessionOf(Math.floor(new Date(r.signal_ts).getTime() / 1000));
    return { key: s.key, label: s.label };
  });
  // Keep chronological session order rather than whatever the map produced.
  const order = new Map(SESSIONS.map((s, i) => [s.key, i]));
  return stats.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

export function byWeekday(rows: ReviewRow[]): SliceStat[] {
  const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const stats = sliceStats(rows, (r) => {
    const sec = Math.floor(new Date(r.signal_ts).getTime() / 1000);
    const idx = (new Date(`${nyMeta(sec).dateKey}T12:00:00Z`).getUTCDay() + 6) % 7;
    return { key: String(idx), label: NAMES[idx] };
  });
  return stats.sort((a, b) => Number(a.key) - Number(b.key));
}

export function bySymbol(rows: ReviewRow[]): SliceStat[] {
  return sliceStats(rows, (r) => ({ key: r.symbol, label: r.symbol })).sort((a, b) =>
    a.key.localeCompare(b.key)
  );
}

export function byRegime(rows: ReviewRow[]): SliceStat[] {
  return sliceStats(rows, (r) =>
    r.regime ? { key: r.regime, label: r.regime.replace(/-/g, " ") } : null
  ).sort((a, b) => a.key.localeCompare(b.key));
}
