/* The bot's timer and its quiet spells, in plain words for the Today screen.

   Since 2 November 2026 GitHub's free scheduler has started the engine only
   every 4-8 hours, and the screens said "waiting for usable data" without
   saying why or what fixes it. timerStatus() names the cause and the one-time
   fix (docs/ENGINE-CLOCK.md); quietReasons() says why no trade happened,
   from saved decisions and the loss guards, never a guess. Pure; pinned by
   tests/plain-timer.test.ts. */

import type { BotPolicyRow, EngineClockRow } from "@/lib/neon/client";
import type { ExpOverview } from "@/lib/experiment/view";
import { skipWords } from "./experiment";
import { latestPolicies, sourceName } from "./activity";

export type TimerTone = "good" | "warn" | "bad" | "info";
export interface TimerStatus {
  tone: TimerTone;
  title: string;
  detail: string;
  /** Show the one-time setup link (Guide → "Keep the bot on time"). */
  fix: boolean;
}

/** The engine counts as current within two missed 15-minute slots plus jitter. */
const CURRENT_MIN = 40;
/** A clock row older than this means the clock itself has stopped firing. */
const CLOCK_SILENT_MIN = 90;

export function ago(minutes: number): string {
  if (!Number.isFinite(minutes)) return "a long time";
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

const minutesSince = (iso: string | null | undefined, nowSec: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (nowSec - t / 1000) / 60 : Infinity;
};

export function timerStatus(input: { lastRunAt: string | null; clock: EngineClockRow | null; nowSec: number; asleep: boolean }): TimerStatus {
  const { clock, nowSec, asleep } = input;
  const runAge = minutesSince(input.lastRunAt, nowSec);
  const clockAge = minutesSince(clock?.fired_at, nowSec);
  const clockLive = clock !== null && clockAge <= CLOCK_SILENT_MIN;
  if (asleep) return { tone: "info", title: "Market closed", detail: "The bot checks again when the futures market reopens.", fix: false };
  if (clockLive && clock.outcome === "rejected")
    return { tone: "bad", title: "Timer key refused", detail: "GitHub refused the timer's key, so the bot only runs every few hours. The key may have expired; make a new one (3 minutes).", fix: true };
  if (runAge <= CURRENT_MIN) {
    if (clockLive && clock.outcome === "dispatched") return { tone: "good", title: "On time", detail: "Prices and ideas are checked every 15 minutes.", fix: false };
    return { tone: "good", title: `Checked ${ago(runAge)} ago`, detail: "GitHub's free timer has been hours late since 2 November. A one-time, free setup keeps checks every 15 minutes.", fix: true };
  }
  const late = `Prices were last checked ${ago(runAge)} ago`;
  if (clockLive && clock.outcome === "dispatched")
    return { tone: "warn", title: "Waiting for GitHub", detail: `${late}. The timer asked GitHub to start a check ${ago(clockAge)} ago; GitHub has not run it yet.`, fix: false };
  if (clockLive && clock.outcome === "failed")
    return { tone: "warn", title: "Timer could not reach GitHub", detail: `${late}. The timer will try again within 15 minutes.`, fix: false };
  if (clock !== null && !clockLive)
    return { tone: "warn", title: "Timer is silent", detail: `${late}, and the 15-minute timer has not fired for ${ago(clockAge)}. Its schedule may be switched off.`, fix: true };
  return { tone: "warn", title: "Running late", detail: `${late} because GitHub's free timer is hours late. Fix it once: turn on the 15-minute timer (free, 3 minutes).`, fix: true };
}

const DAY = 86400;

/** Why the bot has not traded lately: saved skip reasons from the last week, paused
    methods, or no ideas at all. At most three lines, most frequent first. */
export function quietReasons(o: ExpOverview | null, policy: BotPolicyRow[], nowSec: number): string[] {
  if (!o) return [];
  const out: string[] = [];
  const week = (o.recent_decisions ?? []).filter((d) => nowSec - Date.parse(d.decided_at) / 1000 <= 7 * DAY);
  const counts = new Map<string, number>();
  for (const d of week) if (d.action === "skip") counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  for (const [reason, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const words = skipWords(reason, o.risk).replace(/^Skipped: /, "");
    out.push(`${n} idea${n === 1 ? "" : "s"} skipped this week: ${words}.`);
  }
  // The same pause/resume reading the activity panel uses (legacy stream keys folded in).
  const paused = [...latestPolicies(policy)].filter(([, p]) => p.action === "paused").map(([key]) => sourceName(key));
  if (paused.length) {
    const seesThem = o.risk?.singleContractMax !== undefined;
    out.push(`${paused.length === 1 ? "1 method is" : `${paused.length} methods are`} paused after a losing streak (${paused.join(", ")}). ${seesThem ? "The bot still decides their ideas." : "Their ideas are held back from the bot."}`);
  }
  if (!week.length && !paused.length) out.push("The methods produced no new ideas this week. Quiet stretches are normal; they wait for their setups.");
  return out.slice(0, 3);
}
