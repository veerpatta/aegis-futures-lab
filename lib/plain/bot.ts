/* The bot's state in one plain sentence, and the engine's health in one word.

   Kept apart from lib/paper/overview.ts on purpose: botState() owns the LABELS
   (tests/trader-overview.test.ts pins them), this file owns how they read to
   someone who has never heard of a paper release. */

import type { BotOverview } from "@/lib/paper/overview";
import { PAPER_RISK } from "@/lib/paper/policy";

export type HealthTone = "good" | "warn" | "bad" | "dim";

export function botSentence(label: string, data: BotOverview | null, reason?: string): string {
  const neverTraded = !data?.release && !(data?.positions?.length);
  switch (label) {
    case "Researching":
      return (
        "The bot checks prices every 15 minutes and tests trading methods. None has beaten chance yet, " +
        "so it isn't trading its practice money" +
        (neverTraded ? " — it has not placed a practice trade so far." : ".")
      );
    case "Paper probation":
      return `A method passed every test. The bot is trading practice money at reduced risk ($${PAPER_RISK.probationRisk} a trade) while it proves itself.`;
    case "Paper active":
      return `A method passed every test. The bot is trading practice money at up to $${PAPER_RISK.riskPerTrade} of risk a trade.`;
    case "Paused":
      return data?.account?.locked
        ? `Practice trading is locked: the account fell $${PAPER_RISK.maxDrawdown.toLocaleString("en-US")} from its high. It stays locked until someone resets it.`
        : `Practice trading is paused. ${reason ?? data?.release?.reason ?? "A check failed."}`;
    default:
      return "The practice account couldn't be checked just now. The figures below may be out of date.";
  }
}

export interface HealthInput {
  loading: boolean;
  loadFailed: boolean;
  stale: boolean;
  asleep: boolean;
  delayed: boolean;
  failing: readonly string[];
  lastRun: { status: string } | null;
}

/** One word for whether the price checks are running, plus a sentence for the sheet. */
export function healthLook(h: HealthInput): { label: string; tone: HealthTone; detail: string } {
  if (h.loading) return { label: "Checking…", tone: "dim", detail: "Reading the latest price check." };
  if (h.lastRun?.status === "error")
    return { label: "Last check failed", tone: "bad", detail: "The latest price check failed. The next one runs within 15 minutes." };
  if (h.loadFailed)
    return { label: "Can't reach the bot", tone: "warn", detail: "The app couldn't read the bot's status. It will retry in a minute." };
  if (h.stale)
    return { label: "Running late", tone: "warn", detail: "A price check was due and hasn't arrived. Ideas catch up on the next pass." };
  if (h.failing.length)
    return { label: "Needs attention", tone: "warn", detail: "Part of the last check had a problem. Trade ideas are still being checked." };
  if (h.asleep)
    return { label: "Resting", tone: "dim", detail: "The market is closed, so the bot is resting. That is the schedule, not a fault." };
  if (h.delayed)
    return { label: "Prices delayed", tone: "warn", detail: "Prices are older than the usual 10–15 minutes. Ideas catch up on the next pass." };
  return { label: "Running", tone: "good", detail: "Price checks are arriving on schedule, every 15 minutes." };
}
