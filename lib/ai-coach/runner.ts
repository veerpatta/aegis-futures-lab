/* Owner-only coach notes: a plain-English story for each finished decision of
   the active campaign, and a short recap of the trading day.

   Shown only to the signed-in owner (NVIDIA's trial terms forbid handing
   generated text to others). Each note is written once per (kind, subject,
   facts hash); a day recap is refreshed only when the day's facts change, at
   most once an hour. A note that fails validation is stored as rejected, for
   audit, and the app shows its own sentence instead. */

import type { ChatRequest, ChatResult } from "@/lib/ai-free/nvidia";
import { FreeAiError } from "@/lib/ai-free/nvidia";
import { cleanText } from "@/lib/ai-free/text";
import { stableHash } from "@/lib/experiment/hash";
import { tradingDayKey } from "@/lib/time/ny";
import { dayFacts, tradeFacts, type DayRecord, type Facts, type TradeRecord } from "./facts";
import { validateNote, type NoteKind } from "./validate";
import { callTimeout, canCall, type RunBudget } from "@/lib/ai-judge/runner";

export const COACH_PROMPT_VERSION = "ai-coach-prompt-v1";
const DAY_REFRESH_MS = 3600_000;
/** Notes are written for decisions recorded in the last week only, so the first
    deploy does not backfill old campaigns. */
export const TRADE_NOTE_WINDOW_SECONDS = 7 * 86400;

export const TRADE_SYSTEM = [
  "You explain one finished decision of a virtual trading bot to its owner, who has never traded.",
  "Write 2 or 3 short sentences of plain English.",
  "Use only the facts given: do not add numbers, prices, times or reasons that are not in the facts.",
  "Say that it was virtual (practice) money.",
  "No advice, no predictions, no markdown, no lists.",
].join(" ");

export const DAY_SYSTEM = [
  "You write a short recap of one trading day of a virtual trading bot for its owner, who has never traded.",
  "Write 3 or 4 short sentences of plain English.",
  "Use only the facts given: do not add numbers or reasons that are not in the facts.",
  "Say that it is virtual (practice) money.",
  "No advice, no predictions, no markdown, no lists.",
].join(" ");

export interface CoachNote {
  kind: NoteKind;
  subject: string;
  factsHash: string;
  facts: Facts;
  model: string;
  promptVersion: string;
  status: "accepted" | "rejected";
  text: string;
  rejectReason: string | null;
}

export interface CoachStore {
  activeExperiment(): Promise<string | null>;
  /** Finished decisions of the experiment recorded since `sinceSec` with no note yet. */
  finishedTrades(experimentId: string, sinceSec: number, limit: number): Promise<TradeRecord[]>;
  day(experimentId: string, dayKey: string, nowSec: number): Promise<DayRecord | null>;
  latestDayNote(dayKey: string): Promise<{ factsHash: string; createdAt: number } | null>;
  save(note: CoachNote, atMs: number): Promise<boolean>;
}
export interface CoachDeps {
  store: CoachStore;
  chat: (req: ChatRequest) => Promise<ChatResult>;
  now: () => number;
}
export interface CoachReport {
  tradeNotes: number;
  dayNotes: number;
  rejected: number;
  errors: number;
}

async function write(kind: "trade" | "day", subject: string, facts: Facts, deps: CoachDeps, budget: RunBudget, report: CoachReport): Promise<void> {
  budget.calls--;
  let result: ChatResult;
  try {
    result = await deps.chat({ system: kind === "trade" ? TRADE_SYSTEM : DAY_SYSTEM, user: JSON.stringify(facts), maxTokens: 1200, temperature: 0.3, timeoutMs: callTimeout(budget, deps.now()), deadline: budget.hardStop });
  } catch (err) {
    if (!(err instanceof FreeAiError)) throw err;
    report.errors++;
    return;
  }
  // Saving happens outside the provider try: a database failure stops the pass.
  const text = cleanText(result.text.replace(/\s+/g, " ").trim(), 2000);
  const verdict = validateNote(text, facts, kind);
  const note: CoachNote = {
    kind, subject, facts, factsHash: stableHash(facts), model: result.model, promptVersion: COACH_PROMPT_VERSION,
    status: verdict.ok ? "accepted" : "rejected", text, rejectReason: verdict.ok ? null : verdict.reason,
  };
  if (await deps.store.save(note, deps.now())) {
    if (!verdict.ok) report.rejected++;
    else if (kind === "trade") report.tradeNotes++;
    else report.dayNotes++;
  }
}

export async function runCoach(deps: CoachDeps, budget: RunBudget): Promise<CoachReport> {
  const report: CoachReport = { tradeNotes: 0, dayNotes: 0, rejected: 0, errors: 0 };
  const experimentId = await deps.store.activeExperiment();
  if (!experimentId) return report;
  const nowSec = Math.floor(deps.now() / 1000);

  const trades = await deps.store.finishedTrades(experimentId, nowSec - TRADE_NOTE_WINDOW_SECONDS, 3);
  for (const t of trades) {
    if (!canCall(budget, deps.now())) return report;
    const facts = tradeFacts(t);
    if (facts) await write("trade", t.decisionKey, facts, deps, budget, report);
  }

  if (!canCall(budget, deps.now())) return report;
  const dayKey = tradingDayKey(nowSec);
  const day = await deps.store.day(experimentId, dayKey, nowSec);
  if (!day) return report;
  const facts = dayFacts(day);
  const latest = await deps.store.latestDayNote(dayKey);
  if (latest && (latest.factsHash === stableHash(facts) || deps.now() - latest.createdAt < DAY_REFRESH_MS)) return report;
  await write("day", dayKey, facts, deps, budget, report);
  return report;
}
