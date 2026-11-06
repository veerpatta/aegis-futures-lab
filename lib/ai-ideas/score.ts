/* Prospective scoring of one AI skip rule (docs/research/2026-11-07-ai-ideas-preregistration.md).

   The rule keeps the ideas it does not match. The kept set is compared with
   take every idea, no trade, and random skips of the same number of ideas in
   each session. Looks are frozen exactly as for the second opinion
   (lib/ai-judge/looks.ts): ordered by when each decision was recorded, taken
   only when every decision in the window is final, stored once. Decisions are
   the rows themselves here, so nothing can be inserted before a window's end
   later (settle time 0). */

import { matchedRandomPercentile, sessionBootstrapMean, type Interval } from "@/lib/experiment/stats";
import { seedOf } from "@/lib/experiment/hash";
import { lookWindow, nextLookIndex, sortForLooks, type LookRow, type StoredLook } from "@/lib/ai-judge/looks";
import type { IdeasLook, IdeasRules } from "./rules";

export interface IdeaRow extends LookRow {
  /** The rule matches, so the idea would be skipped. */
  skip: boolean;
  /** One-contract result after costs; null unless state is "resolved". */
  net: number | null;
}
type Resolved = IdeaRow & { net: number };

export interface IdeaRunning {
  tested: number;
  resolved: number;
  skipped: number;
  sessions: number;
  keptNet: number;
  takeAllNet: number;
  delta: Interval | null;
  randomPercentile: number | null;
}

export interface IdeaLookResult {
  look: number;
  verdict: "pass" | "fail" | "inconclusive";
  resolved: number;
  sessions: number;
  skipped: number;
  keptNet: number;
  takeAllNet: number;
  skipRate: number;
  randomPercentile: number | null;
  delta: Interval | null;
  alpha: number;
  lastDecisionKey: string;
}

const money = (v: number) => Math.round(v * 100) / 100;
const resolvedOf = (rows: readonly IdeaRow[]) => rows.filter((r): r is Resolved => r.state === "resolved" && r.net !== null && Number.isFinite(r.net));

function deltaOf(rows: Resolved[], seed: string, alpha: number, iterations: number): Interval | null {
  if (!rows.length) return null;
  const d = sessionBootstrapMean(rows.map((r) => ({ session: r.session, value: (r.skip ? 0 : r.net) - r.net })), iterations, seedOf(seed, "bootstrap", alpha), alpha);
  return Number.isFinite(d.est) && Number.isFinite(d.lo) && Number.isFinite(d.hi) ? { est: money(d.est), lo: money(d.lo), hi: money(d.hi) } : null;
}

function percentileOf(rows: Resolved[], seed: string, draws: number): number | null {
  const kept = rows.filter((r) => !r.skip).length;
  if (!rows.length || kept === rows.length || kept === 0) return null;
  // "Taken" = kept by the rule; random picks keep the same number per session.
  return Math.round(matchedRandomPercentile(rows.map((r) => ({ session: r.session, value: r.net, take: !r.skip })), draws, seedOf(seed, "random")) * 10) / 10;
}

/** Running totals over everything resolved so far (information only). */
export function runningIdea(rows: readonly IdeaRow[], ruleId: string, rules: IdeasRules): IdeaRunning {
  const tested = rows.filter((r) => r.state !== "excluded");
  const resolved = resolvedOf(rows);
  return {
    tested: tested.length,
    resolved: resolved.length,
    skipped: resolved.filter((r) => r.skip).length,
    sessions: new Set(resolved.map((r) => r.session)).size,
    keptNet: money(resolved.filter((r) => !r.skip).reduce((a, r) => a + r.net, 0)),
    takeAllNet: money(resolved.reduce((a, r) => a + r.net, 0)),
    delta: deltaOf(resolved, ruleId, 0.05, rules.bootstrap.iterations),
    randomPercentile: percentileOf(resolved, ruleId, rules.bootstrap.random),
  };
}

/** The preregistered pass/fail rule on one look's fixed window. */
export function evaluateIdeaLook(window: readonly IdeaRow[], lookIndex: number, look: IdeasLook, ruleId: string, rules: IdeasRules): IdeaLookResult {
  const rows = resolvedOf(window);
  const kept = rows.filter((r) => !r.skip);
  const keptNet = money(kept.reduce((a, r) => a + r.net, 0));
  const skipped = rows.length - kept.length;
  const skipRate = rows.length ? skipped / rows.length : 0;
  const randomPercentile = percentileOf(rows, ruleId, rules.bootstrap.random);
  const delta = deltaOf(rows, ruleId, look.alpha, rules.bootstrap.iterations);
  const pass = delta !== null && delta.lo > 0 && randomPercentile !== null && randomPercentile >= look.percentile && keptNet > 0 &&
    skipRate >= rules.skipRate.min && skipRate <= rules.skipRate.max;
  const fail = delta !== null && delta.hi < 0;
  return {
    look: lookIndex, verdict: pass ? "pass" : fail ? "fail" : "inconclusive", resolved: rows.length, sessions: new Set(rows.map((r) => r.session)).size,
    skipped, keptNet, takeAllNet: money(rows.reduce((a, r) => a + r.net, 0)), skipRate: Math.round(skipRate * 1000) / 1000, randomPercentile, delta,
    alpha: look.alpha, lastDecisionKey: rows[rows.length - 1]?.key ?? "",
  };
}

/** The look that can be taken now, if any, else why the next one waits. */
export function dueIdeaLook(rows: readonly IdeaRow[], stored: readonly StoredLook[], ruleId: string, rules: IdeasRules, nowSec: number): { due: IdeaLookResult } | { waiting: string | null } {
  const index = nextLookIndex(stored, rules.looks.length);
  if (index === null) return { waiting: null };
  const look = rules.looks[index - 1];
  const w = lookWindow(sortForLooks(rows), look.resolved, look.sessions, nowSec, 0);
  if (!w.taken) return { waiting: `Look ${index}: ${w.waiting}.` };
  return { due: evaluateIdeaLook(w.rows, index, look, ruleId, rules) };
}

/** Why a testing rule should now be retired, from its STORED looks, or null. */
export function retireReason(stored: readonly StoredLook[], proposedAtSec: number, nowSec: number, rules: IdeasRules): string | null {
  const latest = [...stored].sort((a, b) => b.look - a.look)[0];
  if (latest && latest.verdict !== "inconclusive") return `${latest.verdict} at look ${latest.look}`;
  if (latest && latest.look >= rules.looks.length) return `final look: ${latest.verdict}`;
  if (nowSec - proposedAtSec >= rules.maxWeeks * 7 * 86400) return `${rules.maxWeeks} weeks without a final look`;
  return null;
}
