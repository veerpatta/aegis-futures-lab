/* Scoring the AI second opinion against its controls (take every idea, no
   trade, matched random picks), and the preregistered looks.

   The verdict comes only from stored looks (lib/ai-judge/looks.ts): each look
   is taken once, on a fixed window of decisions, when every decision in it
   is final, and is then stored write-once. The running numbers below are
   information for the screens, recomputed on every read; they never decide. */

import { matchedRandomPercentile, sessionBootstrapMean, type Interval } from "@/lib/experiment/stats";
import { seedOf } from "@/lib/experiment/hash";
import { lookWindow, nextLookIndex, sortForLooks, type LookRow, type StoredLook } from "./looks";
import type { JudgeLook, JudgeRules } from "./studies";

export interface JudgeScoreRow extends LookRow {
  decision: "take" | "skip";
  /** One-contract result after costs; null unless state is "resolved". */
  net: number | null;
}
type Resolved = JudgeScoreRow & { net: number };

export interface JudgeRunning {
  calls: number;
  resolved: number;
  taken: number;
  skipped: number;
  sessions: number;
  aiNet: number;
  takeAllNet: number;
  randomPercentile: number | null;
  delta: Interval | null;
}

export interface JudgeLookResult {
  look: number;
  verdict: "pass" | "fail" | "inconclusive";
  resolved: number;
  sessions: number;
  taken: number;
  aiNet: number;
  takeAllNet: number;
  takeRate: number;
  randomPercentile: number | null;
  delta: Interval | null;
  alpha: number;
  lastDecisionKey: string;
}

const money = (v: number) => Math.round(v * 100) / 100;
const finiteInterval = (i: Interval): Interval | null =>
  Number.isFinite(i.est) && Number.isFinite(i.lo) && Number.isFinite(i.hi) ? { est: money(i.est), lo: money(i.lo), hi: money(i.hi) } : null;

function resolvedOf(rows: readonly JudgeScoreRow[]): Resolved[] {
  return rows.filter((r): r is Resolved => r.state === "resolved" && r.net !== null && Number.isFinite(r.net));
}

function percentileOf(rows: Resolved[], seed: string, draws: number): number | null {
  const taken = rows.filter((r) => r.decision === "take").length;
  if (!taken) return null;
  return Math.round(matchedRandomPercentile(rows.map((r) => ({ session: r.session, value: r.net, take: r.decision === "take" })), draws, seedOf(seed, "random")) * 10) / 10;
}

function deltaOf(rows: Resolved[], seed: string, alpha: number, iterations: number): Interval | null {
  if (!rows.length) return null;
  const deltas = rows.map((r) => ({ session: r.session, value: (r.decision === "take" ? r.net : 0) - r.net }));
  return finiteInterval(sessionBootstrapMean(deltas, iterations, seedOf(seed, "bootstrap", alpha), alpha));
}

/** Running totals over everything resolved so far (information only). */
export function runningJudge(rows: readonly JudgeScoreRow[], studyId: string, rules: JudgeRules): JudgeRunning {
  // Every answer counts as a call; only resolved, non-excluded ones are scored.
  const resolved = resolvedOf(rows);
  const taken = resolved.filter((r) => r.decision === "take");
  return {
    calls: rows.length,
    resolved: resolved.length,
    taken: rows.filter((r) => r.decision === "take").length,
    skipped: rows.filter((r) => r.decision === "skip").length,
    sessions: new Set(resolved.map((r) => r.session)).size,
    aiNet: money(taken.reduce((a, r) => a + r.net, 0)),
    takeAllNet: money(resolved.reduce((a, r) => a + r.net, 0)),
    randomPercentile: percentileOf(resolved, studyId, rules.bootstrap.random),
    delta: deltaOf(resolved, studyId, 0.05, rules.bootstrap.iterations),
  };
}

/** The preregistered pass/fail rule on one look's fixed window. */
export function evaluateJudgeLook(window: readonly JudgeScoreRow[], lookIndex: number, look: JudgeLook, studyId: string, rules: JudgeRules): JudgeLookResult {
  const rows = resolvedOf(window);
  const taken = rows.filter((r) => r.decision === "take");
  const aiNet = money(taken.reduce((a, r) => a + r.net, 0));
  const takeAllNet = money(rows.reduce((a, r) => a + r.net, 0));
  const takeRate = rows.length ? taken.length / rows.length : 0;
  const randomPercentile = percentileOf(rows, studyId, rules.bootstrap.random);
  const delta = deltaOf(rows, studyId, look.alpha, rules.bootstrap.iterations);
  const pass = delta !== null && delta.lo > 0 && randomPercentile !== null && randomPercentile >= look.percentile && aiNet > 0 &&
    takeRate >= rules.takeRate.min && takeRate <= rules.takeRate.max;
  const fail = (delta !== null && delta.hi < 0) || (aiNet < takeAllNet && (randomPercentile ?? 0) < 50);
  return {
    look: lookIndex, verdict: pass ? "pass" : fail ? "fail" : "inconclusive", resolved: rows.length, sessions: new Set(rows.map((r) => r.session)).size,
    taken: taken.length, aiNet, takeAllNet, takeRate: Math.round(takeRate * 1000) / 1000, randomPercentile, delta, alpha: look.alpha,
    lastDecisionKey: rows[rows.length - 1]?.key ?? "",
  };
}

/** The look that can be taken now, if any, else why the next one waits.
    `settleSec` is how long after a decision an answer about it may still be
    recorded (two hours for the second opinion). */
export function dueJudgeLook(rows: readonly JudgeScoreRow[], stored: readonly StoredLook[], studyId: string, rules: JudgeRules, nowSec: number, settleSec: number):
  { due: JudgeLookResult } | { waiting: string | null } {
  const index = nextLookIndex(stored, rules.looks.length);
  if (index === null) return { waiting: null };
  const look = rules.looks[index - 1];
  const w = lookWindow(sortForLooks(rows), look.resolved, look.sessions, nowSec, settleSec);
  if (!w.taken) return { waiting: `Look ${index}: ${w.waiting}.` };
  return { due: evaluateJudgeLook(w.rows, index, look, studyId, rules) };
}
