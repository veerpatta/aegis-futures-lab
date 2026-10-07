/* The trial account, in plain words.

   "Trial money" is practice money that copies every trade idea, before any
   method has proven itself. It is never called "practice money" on screen —
   that name belongs to the account that only trades a qualified method — and
   every place it appears carries the amber "Not proven" label: following ideas
   from methods that lost in testing is a record, not a recommendation. */

import { TRIAL_RISK, type TrialSkipReason } from "@/lib/trial/policy";
import type { TrialExitReason } from "@/lib/trial/engine";
import type { TrialDecisionRow } from "@/lib/trial/overview";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export const TRIAL_BADGE = "Not proven";
export const TRIAL_BADGE_LONG = "Not proven — copies every idea, including methods that lost in testing";

const SKIPS: Record<TrialSkipReason, string> = {
  "daily-loss": `the day's ${usd(TRIAL_RISK.dailyLoss)} loss limit was reached`,
  "open-risk": "two trades' worth of risk was already open",
  "risk-budget": `one contract would risk more than ${usd(TRIAL_RISK.perTrade)}`,
  locked: `the account is stopped after losing ${usd(TRIAL_RISK.maxDrawdown)} from its best`,
  "no-risk": "its risk could not be worked out",
};

export function skipWords(reason: TrialSkipReason): string {
  return `Skipped: ${SKIPS[reason]}`;
}

const EXITS: Record<TrialExitReason, string> = {
  idea: "Closed with the idea",
  stop: "Stopped out",
  target: "Reached its target",
  session: "Closed at the session's end",
  "daily-loss": "Closed at the daily loss limit",
  drawdown: "Closed when the account stopped",
  "round-end": "Closed when a new round started",
};

export function exitWords(reason: TrialExitReason | null): string {
  return reason ? EXITS[reason] : "Open now";
}

/** The trial line on an idea card: what the trial account did with it. */
export function decisionLine(d: TrialDecisionRow | null, mask: (s: string) => string, money: (v: number) => string): string | null {
  if (!d) return null;
  if (!d.taken) return `Trial account · ${skipWords(d.reason as TrialSkipReason)}`;
  const size = `took ${d.qty} contract${d.qty === 1 ? "" : "s"}`;
  if (d.closed_at === null || d.pnl === null) return `Trial account · ${size} · open`;
  return `Trial account · ${size} · ${mask(money(d.pnl))}`;
}

/** The account's one-sentence state, for Today and Bot. */
export function trialSentence(o: {
  locked: boolean;
  startedLabel: string;
  closed: number;
  wins: number;
  losses: number;
  open: number;
}): string {
  if (o.locked)
    return `Stopped: it lost ${usd(TRIAL_RISK.maxDrawdown)} from its best balance, the same limit the practice account has. It stays stopped until a new round is started.`;
  if (o.closed === 0 && o.open === 0)
    return `Started ${o.startedLabel}. It copies the next idea the methods post — quiet days are normal.`;
  const record = o.closed ? ` ${o.closed} closed: ${o.wins} won, ${o.losses} lost (n=${o.closed}).` : "";
  const open = o.open ? ` ${o.open} open now.` : "";
  return `Copying every idea since ${o.startedLabel}.${record}${open}`;
}

/** The limits sheet, one rule per line. */
export const TRIAL_LIMITS: string[] = [
  `Starts with ${usd(TRIAL_RISK.capital)} of trial money. Nothing here is real money.`,
  `Takes every idea on the Ideas tab at the idea's own size — at most ${usd(TRIAL_RISK.perTrade)} at risk on one idea.`,
  `At most ${usd(TRIAL_RISK.totalOpenRisk)} at risk across open trades at once; an idea that would go over is skipped.`,
  `After losing ${usd(TRIAL_RISK.dailyLoss)} in a day it closes everything and skips the rest of that day's ideas.`,
  `After losing ${usd(TRIAL_RISK.maxDrawdown)} from its best balance it stops for good. Only the owner can start a new round, and every earlier round stays on record.`,
];

/** Why there are two accounts, for the trial sheet. */
export const TRIAL_WHY =
  "No method has passed every test yet, so the practice account has not traded. The trial account shows the bot " +
  "running money through its rules anyway — sizing, limits, closing at the end of the day — by copying every idea. " +
  "It does not mean the ideas work: most come from methods that lost money in testing.";
