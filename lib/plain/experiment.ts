/* The experimental learner, in plain words.

   "Virtual money" is the learner's own $10,000 pretend account. It is never
   called "practice money" — that name belongs to the strict account that only
   trades a method that passed every test — and it is never added to the trade
   ideas' record. Every place it appears says VIRTUAL ONLY and, for live data,
   "delayed". Copy is rendered from the limits, never typed as numbers. */

import { EXP_RISK } from "@/lib/experiment/policy";
import type { ExecutionState, FreshnessState, LearningState } from "@/lib/experiment/view";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export const EXP_NAME = "Experimental learner";
export const EXP_BADGE = "Virtual only";
export const EXP_BADGE_LONG = "Virtual only — pretend money, its own record, separate from practice money and trade ideas";

const SKIPS: Record<string, string> = {
  "model-skip": "its current model said the odds were not good enough",
  "risk-budget": `one contract would risk more than ${usd(EXP_RISK.riskPerTrade)}`,
  "open-risk": `${usd(EXP_RISK.totalOpenRisk)} of risk was already open`,
  "daily-loss": `the day's ${usd(EXP_RISK.dailyLoss)} loss limit was reached`,
  locked: `the campaign stopped after losing ${usd(EXP_RISK.maxDrawdown)} from its best`,
  paused: "the learner was paused",
  "stale-data": "prices were not fresh enough to trade on",
  "stop-too-small": `the stop was closer than ${EXP_RISK.minStopPoints} points`,
  "stop-breached": "price had already passed the stop",
  "target-passed": "price had already reached the target",
  "idea-closed": "the idea had already finished by the time it was seen",
  "session-over": "the session's entry window had closed",
  "no-risk": "its risk could not be worked out",
  "model-invalid": "the model gave an unusable answer",
  quota: "free service limits were nearly used",
};

export function skipWords(reason: string): string {
  return SKIPS[reason] ? `Skipped: ${SKIPS[reason]}` : "Skipped";
}

const EXITS: Record<string, string> = {
  stop: "Stopped out",
  target: "Reached its target",
  session: "Closed at the session's end",
  "session-late": "Closed at the next price after the session ended",
  "daily-loss": "Closed at the daily loss limit",
  drawdown: "Closed when the campaign stopped",
  "campaign-end": "Closed when the campaign ended",
};
export const exitWords = (reason: string | null) => (reason ? EXITS[reason] ?? reason : "Open now");

const CANCELS: Record<string, string> = {
  "stop-breached": "Not filled: the next price was already past the stop",
  "target-passed": "Not filled: the next price was already past the target",
  "stop-too-small": "Not filled: the stop ended up too close",
  "session-over": "Not filled: the session closed first",
  "risk-budget": "Not filled: the risk at the real price was over the limit",
};
export const cancelWords = (reason: string | null) => (reason ? CANCELS[reason] ?? "Not filled" : "Not filled");

export const PROVENANCE: Record<string, { label: string; note: string }> = {
  prospective: { label: "Decided live", note: "Decided before its result was known, on delayed prices. Counts as fresh evidence." },
  late: { label: "Caught up late", note: "Seen more than 30 minutes after the setup. Kept apart; never counts as fresh evidence." },
  replay: { label: "Replay", note: "Archived prices fed in order. Research only, never shown as a trade placed at that time." },
  synthetic: { label: "Synthetic", note: "Generated test prices. Proves the software works, not that anything makes money." },
};

export const EXECUTION_WORDS: Record<ExecutionState, string> = {
  starting: "Starting",
  scanning: "Watching the market",
  managing: "Managing trades",
  waiting: "Waiting",
  paused: "Paused",
  blocked: "Stopped",
  error: "Last check failed",
  unknown: "Status unknown",
};

export const LEARNING_WORDS: Record<LearningState, string> = {
  collecting: "Collecting results",
  training: "Training",
  evaluating: "Evaluating",
  "candidate-ready": "Candidate ready",
  accepted: "Change adopted",
  rejected: "Candidate rejected",
  inconclusive: "No proven gain yet",
  failed: "Learning problem",
};

export const FRESHNESS_WORDS: Record<FreshnessState, string> = {
  current: "Data current",
  delayed: "Data late",
  stale: "Data stale",
  offline: "Offline",
  unavailable: "No data",
};

export type Tone = "good" | "warn" | "bad" | "dim";
export const EXECUTION_TONE: Record<ExecutionState, Tone> = {
  starting: "dim", scanning: "good", managing: "good", waiting: "dim", paused: "warn", blocked: "bad", error: "bad", unknown: "warn",
};
export const LEARNING_TONE: Record<LearningState, Tone> = {
  collecting: "dim", training: "dim", evaluating: "dim", "candidate-ready": "warn", accepted: "good", rejected: "dim", inconclusive: "warn", failed: "bad",
};
export const FRESHNESS_TONE: Record<FreshnessState, Tone> = { current: "good", delayed: "warn", stale: "warn", offline: "warn", unavailable: "warn" };

/** Why a check failed, in plain words (codes from lib/experiment/evaluate.ts). */
export const CHECK_WORDS: Record<string, string> = {
  enoughOutcomes: "At least 150 finished trades it never trained on",
  beatsIncumbent: "Clearly better than the current model on the same ideas",
  beatsNoTrade: "Clearly better than not trading at all",
  beatsRandom: "Better than 95% of random picks on the same days",
  drawdownOk: `Worst likely fall under ${usd(EXP_RISK.maxDrawdown)}`,
  survivesDoubleCosts: "Still positive with costs doubled",
  betterCalibrated: "Its odds are better calibrated than the current model's",
  "numbers-invalid": "Its numbers could not be computed",
};

export const BLOCKER_WORDS: Record<string, string> = {
  "experiment-not-active": "the learner is not active",
  "current-review-not-passed": "this review did not pass",
  "too-few-new-outcomes": "fewer than 10 new finished trades since the last review",
  "needs-second-passing-review": "it needs a second passing review at least 6 days later",
  "fresh-sessions-short": "fewer than 20 fresh trading days since it was registered",
  "fresh-decisions-short": "fewer than 60 fresh ideas since it was registered",
  "fresh-no-gain": "no gain on fresh ideas",
  "fresh-not-positive": "not positive on fresh ideas",
};

export const VERDICT_WORDS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: "Passed this review", tone: "good" },
  fail: { label: "Rejected", tone: "bad" },
  inconclusive: { label: "Inconclusive", tone: "warn" },
  invalid: { label: "Failed its checks", tone: "bad" },
};

export const VERSION_STATUS_WORDS: Record<string, string> = {
  registered: "Registered",
  shadowing: "Shadowing on fresh ideas",
  adopted: "In charge",
  rejected: "Rejected",
  inconclusive: "Inconclusive",
  invalid: "Failed its checks",
  retired: "Retired",
  rolled_back: "Rolled back",
};

const CHANGE_WORDS: Record<string, string> = {
  created: "Created",
  campaign_started: "Campaign started",
  paused: "Paused",
  resumed: "Resumed",
  locked: "Stopped by the drawdown limit",
  stopped: "Stopped",
  day_halted: "Daily loss limit reached",
  challenger_registered: "New version registered",
  challenger_invalid: "Version failed its checks",
  adopted: "Change adopted",
  rejected: "Version rejected",
  inconclusive: "Review inconclusive",
  retired: "Version retired",
  rolled_back: "Rolled back",
  quota_level: "Free limits level changed",
};
export const changeWords = (kind: string) => CHANGE_WORDS[kind] ?? kind;

/** "Version 3" style names from stored ids (…:v1-take-all, …:2026-W41:c2). */
export function versionName(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.endsWith(":v1-take-all")) return "v1 · take every idea";
  if (id.includes(":hist:")) return "Historical candidate";
  const m = id.match(/:(\d{4})-W(\d{2}):c(\d)$/);
  return m ? `Week ${Number(m[2])} · candidate ${m[3]}` : id.split(":").slice(1).join(":");
}

export function specWords(spec: { windowSessions?: number | null; featureSet?: string; l2?: number } | null | undefined): string {
  if (!spec || !spec.featureSet) return "Takes every eligible idea; the risk limits still apply.";
  const win = spec.windowSessions == null ? "all finished trades" : `the last ${spec.windowSessions} trading days`;
  const feats = spec.featureSet === "v2" ? "basic facts plus market context (range and VWAP distance)" : "basic facts about each idea";
  return `Learns from ${win}, using ${feats}. Skips ideas whose odds don't pay for their risk.`;
}

/** The limits sheet, one rule per line. */
export const EXP_LIMITS: string[] = [
  `Starts with ${usd(EXP_RISK.capital)} of virtual money. It is pretend money; nothing here can place a real order.`,
  `At most ${usd(EXP_RISK.riskPerTrade)} at risk on one trade, and ${usd(EXP_RISK.totalOpenRisk)} across open trades at once.`,
  `After losing ${usd(EXP_RISK.dailyLoss)} in a day it closes everything and skips the rest of that day.`,
  `After losing ${usd(EXP_RISK.maxDrawdown)} from its best it stops for good. A new campaign has to be registered, and earlier losses stay on record.`,
  "It never raises its risk after a loss, and a gap through a stop can lose more than planned.",
  "Fills happen on the next price after the decision, with costs on both sides. Stop and target in the same bar count as the stop.",
];

export const EXP_WHY =
  "No method has passed every test, so the practice account has not traded. The experimental learner trades anyway, with pretend money " +
  "and its own record, so the bot's rules and its learning can be watched working. Its results are evidence being collected, not proof " +
  "that anything works, and a losing trade is not automatically a mistake.";

/** One-line take on an idea card: what the learner did with this idea. */
export function decisionLine(d: { action: string; reason: string; qty: number; position_status: string | null; net: number | null } | null, mask: (s: string) => string, money: (v: number) => string): string | null {
  if (!d) return null;
  if (d.action !== "take") return `Learner · ${skipWords(d.reason)}`;
  const size = `took ${d.qty} contract${d.qty === 1 ? "" : "s"}`;
  if (d.position_status === "closed" && d.net !== null) return `Learner · ${size} · ${mask(money(d.net))}`;
  if (d.position_status === "cancelled") return `Learner · ${size} · not filled`;
  return `Learner · ${size} · open`;
}
