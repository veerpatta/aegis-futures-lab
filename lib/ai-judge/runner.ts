/* One pass of the AI second opinion: for each registered study, ask its model
   about the new decisions of the active learner campaign, and probe a waiting
   study's model.

   Integrity rules (docs/research/2026-11-07-ai-second-opinion-preregistration.md):
   - only decisions recorded at or after the study started, asked within two
     hours of being recorded, oldest first;
   - only information up to the decision's cutoff (marketContext enforces it);
   - every attempt is claimed before the call; an answer (or an unusable one)
     is final and write-once, never re-asked; a provider failure is logged and
     may be retried in a later pass while the two-hour window is still open,
     because no answer was seen and so none can be cherry-picked;
   - one model per study, no fallback inside a study. */

import type { ChatRequest, ChatResult } from "@/lib/ai-free/nvidia";
import { FreeAiError } from "@/lib/ai-free/nvidia";
import { CONTEXT_LOOKBACK_SECONDS, marketContext, sessionClock, type JudgeBar } from "./features";
import { JUDGE_SYSTEM, judgeUserMessage, parseJudgeVerdict, type JudgeIdea } from "./prompt";
import { judgeConfigHash, MODEL_PROBE_INTERVAL_MS, studyConfig, type JudgeStudyConfig } from "./studies";

export const MAX_ATTEMPTS = 3;

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
  /** Unanswered decisions of the active learner campaign recorded at or after
      `sinceSec` and no earlier than `freshSinceSec`, oldest first. */
  pending(studyId: string, sinceSec: number, freshSinceSec: number, limit: number): Promise<JudgeDecisionRow[]>;
  bars(symbol: string, fromSec: number, cutoffSec: number): Promise<JudgeBar[]>;
  claim(studyId: string, decisionKey: string, attempt: number, atMs: number): Promise<boolean>;
  /** Write-once final answer (decision or invalid) or a retryable error log. */
  record(studyId: string, decisionKey: string, kind: "decision" | "invalid" | "error", attempt: number, atMs: number, payload: Record<string, unknown>): Promise<boolean>;
  /** Claim this six-hour window's probe; false when it was already used. */
  claimProbe(studyId: string, windowStartMs: number, atMs: number): Promise<boolean>;
  recordProbe(studyId: string, windowStartMs: number, atMs: number, payload: Record<string, unknown>): Promise<void>;
  activate(studyId: string, atMs: number): Promise<boolean>;
}
export interface RunBudget {
  /** Epoch ms after which no new AI call starts. */
  deadline: number;
  /** AI calls still allowed in this pass (shared with the coach). */
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
  const nowSec = Math.floor(deps.now() / 1000);
  const fresh = nowSec - study.rules.freshnessSeconds;
  const pending = await deps.store.pending(study.id, row.startedAt, fresh, 5);
  for (const d of pending) {
    const now = deps.now();
    if (!canCall(budget, now)) return;
    // Re-check the two-hour rule against the clock at the moment of asking.
    if (Math.floor(now / 1000) - d.createdAt > study.rules.freshnessSeconds || d.attempts >= MAX_ATTEMPTS) continue;
    const attempt = d.attempts + 1;
    if (!(await deps.store.claim(study.id, d.decisionKey, attempt, now))) continue;
    const idea = judgeIdea(d);
    if (!idea) {
      await deps.store.record(study.id, d.decisionKey, "invalid", attempt, deps.now(), { reason: "unusable-decision-row" });
      report.invalid++;
      continue;
    }
    const bars = await deps.store.bars(d.symbol, d.infoCutoff - CONTEXT_LOOKBACK_SECONDS, d.infoCutoff);
    const context = marketContext({ bars, cutoffSec: d.infoCutoff, entry: idea.entry, stop: idea.stop });
    const user = judgeUserMessage(idea, context);
    budget.calls--;
    try {
      const result = await deps.chat({ system: JUDGE_SYSTEM, user, models: [study.model], maxTokens: 1500, temperature: 0.2, timeoutMs: callTimeout(budget, deps.now()) });
      const verdict = parseJudgeVerdict(result.text);
      const payload = { model: result.model, promptVersion: study.promptVersion, featureVersion: study.featureVersion, attempt, ms: result.ms, input: user };
      if (verdict) {
        await deps.store.record(study.id, d.decisionKey, "decision", attempt, deps.now(), { ...payload, verdict, responseAt: Math.floor(deps.now() / 1000) });
        report.decided++;
      } else {
        await deps.store.record(study.id, d.decisionKey, "invalid", attempt, deps.now(), { ...payload, reason: "unparseable-answer", raw: result.text.slice(0, 2000) });
        report.invalid++;
      }
    } catch (err) {
      const e = err instanceof FreeAiError ? err : new FreeAiError("network");
      await deps.store.record(study.id, d.decisionKey, "error", attempt, deps.now(), { code: e.code, status: e.status, model: study.model });
      report.errors++;
    }
  }
}

async function probeStudy(study: JudgeStudyConfig, deps: JudgeDeps, budget: RunBudget, report: JudgeReport) {
  const now = deps.now();
  if (!canCall(budget, now)) return;
  const window = Math.floor(now / MODEL_PROBE_INTERVAL_MS) * MODEL_PROBE_INTERVAL_MS;
  if (!(await deps.store.claimProbe(study.id, window, now))) return;
  budget.calls--;
  try {
    await deps.chat({ system: "Reply with the single word: ready", user: "Are you available?", models: [study.model], maxTokens: 64, timeoutMs: Math.min(20_000, callTimeout(budget, deps.now())) });
    const activated = await deps.store.activate(study.id, deps.now());
    await deps.store.recordProbe(study.id, window, deps.now(), { outcome: "answered", activated });
    if (activated) report.activated.push(study.id);
    report.probes.push({ study: study.id, outcome: "answered" });
  } catch (err) {
    const e = err instanceof FreeAiError ? err : new FreeAiError("network");
    await deps.store.recordProbe(study.id, window, deps.now(), { outcome: e.code, status: e.status });
    report.probes.push({ study: study.id, outcome: e.code });
  }
}

export async function runJudge(deps: JudgeDeps, budget: RunBudget): Promise<JudgeReport> {
  const report: JudgeReport = { decided: 0, invalid: 0, errors: 0, skipped: [], activated: [], probes: [] };
  const rows = await deps.store.studies();
  const known = rows.flatMap((row) => {
    const config = studyConfig(row.id);
    // A registration that does not match the frozen code is never run.
    if (!config || row.configHash !== judgeConfigHash(config)) {
      report.skipped.push(row.id);
      return [];
    }
    return [{ config, row }];
  });
  // New decisions first: they have a two-hour window. Probes can wait.
  for (const { config, row } of known) if (row.status === "active") await askStudy(config, row, deps, budget, report);
  for (const { config, row } of known) if (row.status === "waiting-for-model") await probeStudy(config, deps, budget, report);
  return report;
}
