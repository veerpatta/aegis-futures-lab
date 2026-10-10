import { nyTimeToUnix } from "@/lib/time/ny";
import type { DisplayZone } from "@/lib/time/zones";
import type { BotPolicyRow } from "@/lib/neon/client";
import { BREAKER_RULES, type BreakerEvidence } from "@/lib/engine/breaker-evidence";

const formats = { ET: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }), IST: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }) };
export function calendarDay(nowSec: number, zone: DisplayZone): string {
  const parts = formats[zone].formatToParts(new Date(nowSec * 1000));
  return ["year", "month", "day"].map(k => parts.find(p => p.type === k)!.value).join("-");
}
export function previousDay(day: string): string { return new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10); }
/** Calendar days, not exchange sessions. ET daylight changes make 23/25h days. */
export function dayBounds(day: string, zone: DisplayZone): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) throw new Error("Choose a valid day.");
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const at = (key: string) => zone === "ET" ? nyTimeToUnix(key, 0) : Date.parse(`${key}T00:00:00+05:30`) / 1000;
  return { start: new Date(at(day) * 1000).toISOString(), end: new Date(at(next) * 1000).toISOString() };
}
export function canonicalStream(key: string): string { return /^B:(MES|MNQ)$/.test(key) ? `B:rsi-reversion:${key.slice(2)}` : key; }
export function latestPolicies(rows: BotPolicyRow[], before?: string): Map<string, BotPolicyRow> {
  const out = new Map<string, BotPolicyRow>();
  for (const p of [...rows].filter(p => !before || p.changed_at < before).sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.id - a.id)) {
    if (p.action !== "paused" && p.action !== "resumed") continue;
    const key = canonicalStream(p.stream);
    if (!out.has(key)) out.set(key, p);
  }
  return out;
}
export function sourceName(key: string): string {
  if (key === "A") return "Zone setups · S&P + Nasdaq";
  return key.includes("rsi-reversion") ? `RSI reversion · ${key.split(":").at(-1)}` : key;
}
export function pauseTrigger(b?: BreakerEvidence, p?: BotPolicyRow): string {
  const pf = b?.triggerPf ?? p?.metrics?.rollingPf, n = b?.triggerWindow ?? p?.metrics?.window;
  if (typeof pf === "number" && Number.isFinite(pf) && typeof n === "number" && Number.isFinite(n))
    return `Recorded profit-to-loss ratio ${pf.toFixed(2)} across ${n} closed results; pause threshold below ${BREAKER_RULES.pausePf.toFixed(2)}.`;
  return "The source loss guard paused this method. Its exact trigger value was not recorded in the available snapshot.";
}
export function recoveryWords(b?: BreakerEvidence): string {
  if (!b || b.error) return "Recovery progress is unavailable in this saved update. It is never estimated from the learner's trades.";
  if (b.frozen) return "Automatic pause changes are frozen. Practice continues; recovery cannot resume the source while frozen.";
  const n = Math.min(BREAKER_RULES.resumeWindow, b.recoveryCount), days = Math.min(BREAKER_RULES.tradingDays, b.daysSinceFlip ?? 0);
  const ratio = b.recoveryNoLosses ? "no losses and at least one win" : b.recoveryPf === null ? "no measurable ratio yet" : `profit-to-loss ratio ${b.recoveryPf.toFixed(2)}`;
  return `${n}/${BREAKER_RULES.resumeWindow} closed practice results; ${ratio}. ${days}/${BREAKER_RULES.tradingDays} trading days since the last change.`;
}
export const SOURCE_GATES: Record<string, string> = { hours: "Outside entry hours", noSignal: "No trigger", news: "News pause", lock: "Source discipline limit", riskUnfit: "Source risk did not fit", stopTooTight: "Stop too close", barGap: "Gap in price data", nesting: "No matching hourly zone", noHtf: "No higher-timeframe zone nearby", noTouch: "Price has not reached the zone", weakZone: "Zone too weak", notFresh: "Zone already used", blocked80: "Blocked by the 80% rule", belowMinScore: "Zone score below its minimum", intermarket: "Markets disagreed", firstZone: "First market to the zone", invalidFill: "Price gapped through entry", noConfirm: "No confirmation candle" };
