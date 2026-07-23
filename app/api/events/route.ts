import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* Layered economic calendar, response shape unchanged.

   Primary: ForexFactory's free weekly feed (no key), filtered to
   high-impact USD events. Fallback + long-range floor: the hardcoded
   BLS/Fed list below, taken from the official release schedules
   (bls.gov/schedule — published through Dec 2026 as of 2026-07-23; the
   2027 BLS schedule is not out yet) and the Fed's FOMC calendar (2027
   meetings are officially scheduled but tentative). Extend the list when
   BLS publishes 2027. Merge: union both, dedupe within ±30 min of a
   similar name preferring the ForexFactory entry, only events from 7 days
   ago onward. */

const RAW: Array<[string, string, string, string]> = [
  ["U.S. Employment Situation (NFP)", "2026-06-05T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for May 2026"],
  ["U.S. Consumer Price Index", "2026-06-10T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for May 2026"],
  ["U.S. Producer Price Index", "2026-06-11T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for May 2026"],
  ["FOMC policy decision", "2026-06-17T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-07-02T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for June 2026"],
  ["U.S. Consumer Price Index", "2026-07-14T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for June 2026"],
  ["U.S. Producer Price Index", "2026-07-15T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for June 2026"],
  ["FOMC policy decision", "2026-07-29T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-08-07T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for July 2026"],
  ["U.S. Consumer Price Index", "2026-08-12T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for July 2026"],
  ["U.S. Producer Price Index", "2026-08-13T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for July 2026"],
  ["U.S. Employment Situation (NFP)", "2026-09-04T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for August 2026"],
  ["U.S. Producer Price Index", "2026-09-10T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for August 2026"],
  ["U.S. Consumer Price Index", "2026-09-11T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for August 2026"],
  ["FOMC policy decision", "2026-09-16T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-10-02T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for September 2026"],
  ["U.S. Consumer Price Index", "2026-10-14T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for September 2026"],
  ["U.S. Producer Price Index", "2026-10-15T12:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for September 2026"],
  ["FOMC policy decision", "2026-10-28T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Employment Situation (NFP)", "2026-11-06T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for October 2026"],
  ["U.S. Consumer Price Index", "2026-11-10T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for October 2026"],
  ["U.S. Producer Price Index", "2026-11-13T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for October 2026"],
  ["U.S. Employment Situation (NFP)", "2026-12-04T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "Employment Situation for November 2026"],
  ["FOMC policy decision", "2026-12-09T19:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["U.S. Consumer Price Index", "2026-12-10T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "CPI for November 2026"],
  ["U.S. Producer Price Index", "2026-12-15T13:30:00.000Z", "U.S. Bureau of Labor Statistics", "PPI for November 2026"],
  // 2027 FOMC meetings (federalreserve.gov, tentative until confirmed).
  // Statement 14:00 ET; US DST runs 2027-03-14 → 2027-11-07.
  ["FOMC policy decision", "2027-01-27T19:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-03-17T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-04-28T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-06-09T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-07-28T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-09-15T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-10-27T18:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
  ["FOMC policy decision", "2027-12-08T19:00:00.000Z", "Federal Reserve", "Scheduled policy statement and press conference"],
];

interface CalendarEvent {
  name: string;
  time: string; // ISO
  publisher: string;
  note: string;
}

const staticEvents: CalendarEvent[] = RAW.map(([name, time, publisher, note]) => ({
  name,
  time,
  publisher,
  note,
}));

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

interface FfEntry {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
}

async function fetchForexFactory(): Promise<CalendarEvent[]> {
  const response = await fetch(FF_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`ForexFactory upstream ${response.status}`);
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("ForexFactory payload is not an array");
  const out: CalendarEvent[] = [];
  for (const raw of json as FfEntry[]) {
    if (raw?.country !== "USD" || raw?.impact !== "High") continue;
    if (typeof raw.title !== "string" || typeof raw.date !== "string") continue;
    const ms = Date.parse(raw.date); // ISO with offset, e.g. 2026-07-20T08:30:00-04:00
    if (!Number.isFinite(ms)) continue;
    out.push({
      name: raw.title,
      time: new Date(ms).toISOString(),
      publisher: "ForexFactory weekly feed",
      note: [
        typeof raw.forecast === "string" && raw.forecast ? `forecast ${raw.forecast}` : null,
        typeof raw.previous === "string" && raw.previous ? `previous ${raw.previous}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "High-impact USD event",
    });
  }
  return out;
}

/* Coarse topic tag so "CPI m/m" (FF) and "U.S. Consumer Price Index"
   (static) count as the same event when their times are within ±30 min. */
function topic(name: string): string {
  const n = name.toLowerCase();
  if (/(non-?farm|nfp|employment situation|payroll)/.test(n)) return "nfp";
  if (/(consumer price|\bcpi\b)/.test(n)) return "cpi";
  if (/(producer price|\bppi\b)/.test(n)) return "ppi";
  if (/(fomc|federal funds|fed interest|rate decision)/.test(n)) return "fomc";
  return `name:${n.replace(/[^a-z0-9]+/g, " ").trim()}`;
}

const THIRTY_MIN = 30 * 60_000;

/* Union both lists; where a static event sits within ±30 min of a similar
   ForexFactory one, the ForexFactory entry wins (fresher times/notes). */
function merge(ff: CalendarEvent[], fallback: CalendarEvent[]): CalendarEvent[] {
  const out = [...ff];
  for (const ev of fallback) {
    const ms = Date.parse(ev.time);
    const dup = ff.some(
      (f) => topic(f.name) === topic(ev.name) && Math.abs(Date.parse(f.time) - ms) <= THIRTY_MIN
    );
    if (!dup) out.push(ev);
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export async function GET() {
  let ff: CalendarEvent[] = [];
  let ffError: string | null = null;
  try {
    ff = await fetchForexFactory();
  } catch (e) {
    ffError = e instanceof Error ? e.message : String(e);
  }
  const cutoff = Date.now() - 7 * 86_400_000;
  const events = merge(ff, staticEvents).filter((e) => Date.parse(e.time) >= cutoff);
  const live = ff.length > 0;
  return NextResponse.json(
    {
      source: live ? "ForexFactory + BLS/Fed static fallback" : "BLS + FED OFFICIAL (static fallback)",
      verified: !live, // static-only responses carry only official-schedule dates
      coverage: live
        ? ["High-impact USD events (this week)", "CPI", "PPI", "Employment Situation (NFP)", "FOMC policy decisions"]
        : ["CPI", "PPI", "Employment Situation (NFP)", "FOMC policy decisions"],
      limitation: live
        ? "Weekly feed covers the current week only; beyond it, the official BLS/Fed schedule fills in. Unscheduled speeches still require a licensed real-time calendar."
        : ffError
          ? `Live weekly feed unavailable (${ffError}); serving the official BLS/Fed schedule. Unscheduled events require a licensed real-time calendar.`
          : "No high-impact USD events in the live weekly feed right now; serving the official BLS/Fed schedule. Unscheduled events require a licensed real-time calendar.",
      events,
    },
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=21600" } }
  );
}
