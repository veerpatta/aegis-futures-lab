/* One pass of the AI second opinion: for each registered study, ask its model
   about the new decisions of the active learner campaign, probe a waiting
   study's model, and take any look that has become due.

   Integrity rules (docs/research/2026-11-07-ai-second-opinion-preregistration.md):
   - only decisions recorded at or after the study started, asked (and the
     answer recorded) within two hours of the decision, oldest first;
   - only information up to the decision's cutoff (marketContext enforces it);
   - every attempt is claimed before the call; an answer (including an empty
     or unusable one) is final and write-once; a provider failure, where no
     answer was seen, may be retried in a later pass, at most three attempts;
   - a failure to SAVE stops the pass: it is never logged as a provider error
     and never re-asked at once (the database also refuses a final answer
     without a claim or after the two-hour window);
   - one model per study, no fallback, its own short "not found" memory;
   - each study gets its own share of the calls, in a fixed order. */

import type { ChatRequest, ChatResult } from "@/lib/ai-free/nvidia";
import { FreeAiError } from "@/lib/ai-free/nvidia";
import { cleanText } from "@/lib/ai-free/text";
import { CONTEXT_LOOKBACK_SECONDS, marketContext, sessionClock, type JudgeBar } from "./features";
import type { StoredLook } from "./looks";
import { JUDGE_SYSTEM, judgeUserMessage, parseJudgeVerdict, type JudgeIdea } from "./prompt";
import { dueJudgeLook, type JudgeLookResult, type JudgeScoreRow } from "./score";
import { JUDGE_STUDIES, judgeConfigHash, MODEL_PROBE_INTERVAL_MS, studyConfig, type JudgeStudyConfig } from "./studies";

export const MAX_ATTEMPTS = 3;
/** An attempt with no answer and no error for this long was abandoned. */
export const ABANDONED_CLAIM_SECONDS = 180;
/** Each study may use at most this many of a pass's calls. */
export const CALLS_PER_STUDY = 2;
/** The single-model studies forget a "not found" after 15 minutes. */
export const JUDGE_MEMORY = Object.freeze({ scope: "judge", ms: 15 * 60_000 });
/** Ask only if the answer can still be recorded inside the two-hour window. */
const RECORD_MARGIN_SECONDS = 90;

export interface JudgeStudyRow {
  id: string;
  status: "active" | "waiting-for-model";
  startedAt: number | null;
  configHash: string;
}
export interface JudgeDecisionRow {
  decisionKey: string;
  symbol: string;
  side: string;
  sessionKey: string;
  /** Unix seconds. */
  infoCutoff: number;
  createdAt: number;
  idea: Record<string, unknown> | null;
  features: Record<string, unknown> | null;
  attempts: number;
}
export interface JudgeStore {
  studies(): Promise<JudgeStudyRow[]>;
  /** Decisions of the active learner campaign recorded at or after `sinceSec`
      and no earlier than `freshSinceSec`, without a final answer, with fewer
      than MAX_ATTEMPTS claims and no attempt in progress (a claim younger than
      ABANDONED_CLAIM_SECONDS with neither an answer nor an error), oldest first. */
  pending(studyId: string, sinceSec: number, freshSinceSec: number, limit: number): Promise<JudgeDecisionRow[]>;
  bars(symbol: string, fromSec: number, cutoffSec: number): Promise<JudgeBar[]>;
  claim(studyId: string, decisionKey: string, attempt: number, atMs: number): Promise<boolean>;
  /** Write-once final answer (decision or invalid) or a retryable error log.
      Returns false when it was not inserted (already there). Throws when the
      database fails: the caller must stop. */
  record(studyId: string, decisionKey: string, kind: "decision" | "invalid" | "error", attempt: number, atMs: number, payload: Record<string, unknown>): Promise<boolean>;
  /** Claim this six-hour window's probe; false when it was already used. */
  claimProbe(studyId: string, windowStartMs: number, atMs: number): Promise<boolean>;
  recordProbe(studyId: string, windowStartMs: number, atMs: number, payload: Record<string, unknown>): Promise<void>;
  activate(studyId: string, atMs: number): Promise<boolean>;
  /** The study's answered decisions, for looks and scoring. */
  scoreRows(studyId: string): Promise<JudgeScoreRow[]>;
  looks(studyId: string): Promise<StoredLook[]>;
  /** Write-once; false when this look was already stored. */
  saveLook(studyId: string, result: JudgeLookResult, atMs: number): Promise<boolean>;
}
export interface RunBudget {
  /** Epoch ms after which no new AI call starts. */
  deadline: number;
  /** AI calls still allowed in this pass (shared with the coach and ideas). */
  calls: number;
  /** Epoch ms by which every call must have ended (the platform's time limit
      minus a margin), so a slow model is cut off cleanly instead of the whole
      pass being killed mid-write. */
  hardStop?: number;
}

/** Longest single call: free-tier answers can take 10-30 s (2026-11-06 probes). */
export const MAX_CALL_MS = 40_000;
/** No call starts with less time than this before the hard stop. */
const MIN_CALL_MS = 8_000;

export function callTimeout(budget: RunBudget, now: number): number {
  return Math.max(1_000, Math.min(MAX_CALL_MS, (budget.hardStop ?? Number.POSITIVE_INFINITY) - now));
}
export function canCall(budget: RunBudget, now: number): boolean {
  return budget.calls > 0 && now < budget.deadline && (budget.hardStop === undefined || budget.hardStop - now >= MIN_CALL_MS);
}

export interface JudgeDeps {
  store: JudgeStore;
  chat: (req: ChatRequest) => Promise<ChatResult>;
  now: () => number;
}
export interface JudgeReport {
  decided: number;
  invalid: number;
  errors: number;
  skipped: string[];
  activated: string[];
  probes: { study: string; outcome: string }[];
  looks: { study: string; look: number; verdict: string }[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown): number | null => (finite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The idea as the model will see it, or null if the saved row is unusable. */
export function judgeIdea(row: JudgeDecisionRow): JudgeIdea | null {
  const idea = row.idea ?? {};
  const features = row.features ?? {};
  const entry = num(idea.entry), stop = num(idea.stop), target = num(idea.target);
  const strategy = text(idea.strategy);
  if ((row.symbol !== "MES" && row.symbol !== "MNQ") || (row.side !== "LONG" && row.side !== "SHORT") || entry === null || stop === null || !strategy || entry === stop)
    return null;
  const evidence = (idea.decisionEvidence ?? null) as Record<string, unknown> | null;
  const clock = sessionClock(row.infoCutoff);
  return {
    symbol: row.symbol,
    side: row.side,
    strategy,
    paused: idea.sourcePaused === true,
    entry,
    stop,
    target,
    rewardRisk: num(idea.rr),
    riskUsdOneContract: num(evidence?.contractRisk),
    newYorkTime: clock.newYork,
    minutesUntilFlat: clock.minutesUntilFlat,
    features: { regime: text(features.regime), vixBucket: text(features.vix_bucket), atrPct: num(features.atr_pct), vwapAtr: num(features.vwap_atr) },
  };
}

async function askStudy(study: JudgeStudyConfig, row: JudgeStudyRow, deps: JudgeDeps, budget: RunBudget, report: JudgeReport) {
  if (row.startedAt === null) return;
  const window = study.rules.freshnessSeconds - RECORD_MARGIN_SECONDS;
  const pending = await deps.store.pending(study.id, row.startedAt, Math.floor(deps.now() / 1000) - window, CALLS_PER_STUDY * 2);
  let used = 0;
  for (const d of pending) {
    const now = deps.now();
    if (used >= CALLS_PER_STUDY || !canCall(budget, now)) return;
    // Re-check against the clock at the moment of asking.
    if (Math.floor(now / 1000) - d.createdAt > window || d.attempts >= MAX_ATTEMPTS) continue;
    const attempt = d.attempts + 1;
    if (!(await deps.store.claim(study.id, d.decisionKey, attempt, now))) continue;
    const idea = judgeIdea(d);
    if (!idea) {
      if (await deps.store.record(study.id, d.decisionKey, "invalid", attempt, deps.now(), { reason: "unusable-decision-row" })) report.invalid++;
      continue;
    }
    const bars = await deps.store.bars(d.symbol, d.infoCutoff - CONTEXT_LOOKBACK_SECONDS, d.infoCutoff);
    const context = marketContext({ bars, cutoffSec: d.infoCutoff, entry: idea.entry, stop: idea.stop });
    const user = judgeUserMessage(idea, context);
    budget.calls--;
    used++;
    const base = { model: study.model, promptVersion: study.promptVersion, featureVersion: study.featureVersion, attempt, input: user };
    let result: ChatResult | null = null;
    let failure: FreeAiError | null = null;
    try {
      result = await deps.chat({ system: JUDGE_SYSTEM, user, models: [study.model], maxTokens: 1500, temperature: 0.2, timeoutMs: callTimeout(budget, deps.now()), deadline: budget.hardStop, memory: JUDGE_MEMORY });
    } catch (err) {
      if (!(err instanceof FreeAiError)) throw err;
      failure = err;
    }
    // Saving happens outside the provider try: a database failure stops the
    // pass instead of being logged as a provider error.
    if (failure && failure.code !== "empty") {
      if (await deps.store.record(study.id, d.decisionKey, "error", attempt, deps.now(), { code: failure.code, status: failure.status, model: study.model })) report.errors++;
      continue;
    }
    const verdict = result ? parseJudgeVerdict(result.text) : null;
    if (result && verdict) {
      const saved = { ...base, model: result.model, ms: result.ms, verdict: { ...verdict, reason: cleanText(verdict.reason, 1200) }, responseAt: Math.floor(deps.now() / 1000) };
      if (await deps.store.record(study.id, d.decisionKey, "decision", attempt, deps.now(), saved)) report.decided++;
    } else {
      // An empty or unusable answer is a real answer: final, never re-asked.
      const saved = { ...base, reason: result ? "unparseable-answer" : "empty-answer", raw: result ? cleanText(result.text, 2000) : "" };
      if (await deps.store.record(study.id, d.decisionKey, "invalid", attempt, deps.now(), saved)) report.invalid++;
    }
  }
}

async function probeStudy(study: JudgeStudyConfig, deps: JudgeDeps, budget: RunBudget, report: JudgeReport) {
  const now = deps.now();
  if (!canCall(budget, now)) return;
  const window = Math.floor(now / MODEL_PROBE_INTERVAL_MS) * MODEL_PROBE_INTERVAL_MS;
  if (!(await deps.store.claimProbe(study.id, window, now))) return;
  budget.calls--;
  let outcome: { outcome: string; status?: number | null } = { outcome: "answered" };
  try {
    // The probe shares the chain's six-hour memory: it is the availability check.
    await deps.chat({ system: "Reply with the single word: ready", user: "Are you available?", models: [study.model], maxTokens: 64, timeoutMs: Math.min(20_000, callTimeout(budget, deps.now())), deadline: budget.hardStop });
  } catch (err) {
    if (!(err instanceof FreeAiError)) throw err;
    outcome = { outcome: err.code, status: err.status };
  }
  const activated = outcome.outcome === "answered" ? await deps.store.activate(study.id, deps.now()) : false;
  await deps.store.recordProbe(study.id, window, deps.now(), { ...outcome, activated });
  if (activated) report.activated.push(study.id);
  report.probes.push({ study: study.id, outcome: outcome.outcome });
}

/** Take and store every look that has become due (no AI call). */
async function takeLooks(study: JudgeStudyConfig, deps: JudgeDeps, report: JudgeReport) {
  const [rows, stored] = await Promise.all([deps.store.scoreRows(study.id), deps.store.looks(study.id)]);
  const due = dueJudgeLook(rows, stored, study.id, study.rules, Math.floor(deps.now() / 1000), study.rules.freshnessSeconds);
  if ("due" in due && (await deps.store.saveLook(study.id, due.due, deps.now()))) report.looks.push({ study: study.id, look: due.due.look, verdict: due.due.verdict });
}

export async function runJudge(deps: JudgeDeps, budget: RunBudget): Promise<JudgeReport> {
  const report: JudgeReport = { decided: 0, invalid: 0, errors: 0, skipped: [], activated: [], probes: [], looks: [] };
  const rows = await deps.store.studies();
  // A fixed order from the code, never the database's.
  const order = new Map(JUDGE_STUDIES.map((s, i) => [s.id, i]));
  const known = rows.flatMap((row) => {
    const config = studyConfig(row.id);
    // A registration that does not match the frozen code is never run.
    if (!config || row.configHash !== judgeConfigHash(config)) {
      report.skipped.push(row.id);
      return [];
    }
    return [{ config, row }];
  }).sort((a, b) => (order.get(a.config.id) ?? 99) - (order.get(b.config.id) ?? 99));
  // New decisions first: they have a two-hour window. Probes and looks can wait.
  for (const { config, row } of known) if (row.status === "active") await askStudy(config, row, deps, budget, report);
  for (const { config, row } of known) if (row.status === "waiting-for-model") await probeStudy(config, deps, budget, report);
  for (const { config, row } of known) if (row.status === "active") await takeLooks(config, deps, report);
  return report;
}
