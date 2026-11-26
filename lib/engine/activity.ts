/** Versioned source-pass outcome in the existing append-only heartbeat.
 * No schema change; old runs have no structured record and remain readable. */
export interface SourceActivity {
  version: 1;
  codeSha: string | null;
  observedAt: string;
  marketAsOf: Record<string, string | null>;
  tradingDay: string;
  state: "market-closed" | "outside-entry-hours" | "data-unavailable" | "data-stale" | "source-paused" | "no-eligible-ideas" | "ideas-available" | "component-error";
  reasonCodes: string[];
  pausedStreams: string[];
  simulatedIdeas: number;
  eligibleIdeas: number;
}
const MARKER = "activity_v1=";
/** Heartbeat run-live.ts writes on a CME full holiday. Such a pass fetches no
 * market and records no source activity, so publish.ts has nothing to publish
 * and must rest quietly instead of failing the workflow every 15 minutes. */
const HOLIDAY_SKIP_PREFIX = "holiday: ";
export const holidaySkipMessage = (name: string) => `${HOLIDAY_SKIP_PREFIX}${name} — market closed, run skipped`;
export const isHolidaySkip = (message: string | null | undefined) => typeof message === "string" && message.startsWith(HOLIDAY_SKIP_PREFIX);
export function sourceActivity(input: Omit<SourceActivity, "version" | "state" | "reasonCodes"> & { scheduled: boolean; entryWindow: boolean; stale: boolean; errors: string[] }): SourceActivity {
  const { scheduled, entryWindow, stale, errors, ...record } = input;
  const missing = Object.values(record.marketAsOf).some(t => t === null);
  const reasonCodes = [...errors, ...(!scheduled ? ["market-closed"] : !entryWindow ? ["outside-entry-hours"] : []), ...(missing ? ["data-unavailable"] : stale && entryWindow ? ["data-stale"] : []), ...(record.pausedStreams.length ? ["source-paused"] : []), ...(record.eligibleIdeas === 0 ? ["no-eligible-ideas"] : [])];
  const state = errors.length ? "component-error" : !scheduled ? "market-closed" : missing ? "data-unavailable" : stale && entryWindow ? "data-stale" : !entryWindow ? "outside-entry-hours" : record.eligibleIdeas > 0 ? "ideas-available" : record.pausedStreams.length ? "source-paused" : "no-eligible-ideas";
  return { version: 1, ...record, state, reasonCodes };
}
export const activityMarker = (record: SourceActivity) => `${MARKER}${JSON.stringify(record)}`;
export function readSourceActivity(message: string | null): SourceActivity | null {
  const start = message?.lastIndexOf(MARKER) ?? -1;
  if (start < 0) return null;
  try {
    const a = JSON.parse(message!.slice(start + MARKER.length)) as SourceActivity;
    if (a.version !== 1 || !Array.isArray(a.reasonCodes) || !Array.isArray(a.pausedStreams) || !a.marketAsOf || !Object.hasOwn(SOURCE_STATE_WORDS, a.state) || !Number.isFinite(Date.parse(a.observedAt)) || !Number.isFinite(a.eligibleIdeas) || !Number.isFinite(a.simulatedIdeas)) return null;
    return a;
  } catch { return null; }
}
export const SOURCE_STATE_WORDS: Record<SourceActivity["state"], string> = {
  "market-closed": "Market closed; the schedule is resting",
  "outside-entry-hours": "Prices checked outside entry hours",
  "data-unavailable": "Required price data is missing",
  "data-stale": "Price data is too old for new entries",
  "source-paused": "Source methods paused; no eligible ideas",
  "no-eligible-ideas": "Check completed; no eligible ideas",
  "ideas-available": "Eligible ideas available to publish",
  "component-error": "Check completed with a component problem",
};
