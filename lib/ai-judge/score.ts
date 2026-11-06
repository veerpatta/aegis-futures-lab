/* Scoring the AI second opinion against its controls (take every idea, no
   trade, matched random picks), and the preregistered verdict.

   The verdict is group-sequential: each look is taken ONCE, on exactly the
   first N resolved calls in decision order, and frozen. Recomputing a verdict
   on every new trade would be continuous peeking, which makes a lucky streak
   look like skill. The running numbers are shown for information only. */

import { matchedRandomPercentile, sessionBootstrapMean, type Interval } from "@/lib/experiment/stats";
import { seedOf } from "@/lib/experiment/hash";
import type { JudgeRules } from "./studies";

export interface JudgeScoreRow {
  key: string;
  session: string;
  /** Decision time (unix seconds): the order in which looks consume rows. */
  at: number;
  decision: "take" | "skip";
  /** One-contract net after costs; null while unresolved. */
  net: number | null;
}

export type JudgeVerdictLabel = "too-early" | "inconclusive" | "pass" | "fail";

export interface JudgeScore {
  calls: number;
  resolved: number;
  taken: number;
  skipped: number;
  sessions: number;
  aiNet: number;
  takeAllNet: number;
  randomPercentile: number | null;
  delta: Interval | null;
  verdict: JudgeVerdictLabel;
  /** The next look's size, or null after the last look. */
  nextLook: number | null;
}

const money = (v: number) => Math.round(v * 100) / 100;
const finiteInterval = (i: Interval): Interval | null =>
  Number.isFinite(i.est) && Number.isFinite(i.lo) && Number.isFinite(i.hi) ? { est: money(i.est), lo: money(i.lo), hi: money(i.hi) } : null;

interface Evidence {
  resolved: number;
  sessions: number;
  taken: number;
  aiNet: number;
  takeAllNet: number;
  percentile: number | null;
}

function evidenceOf(rows: { session: string; decision: "take" | "skip"; net: number }[], seed: string, randomDraws: number): Evidence {
  const taken = rows.filter((r) => r.decision === "take");
  return {
    resolved: rows.length,
    sessions: new Set(rows.map((r) => r.session)).size,
    taken: taken.length,
    aiNet: money(taken.reduce((a, r) => a + r.net, 0)),
    takeAllNet: money(rows.reduce((a, r) => a + r.net, 0)),
    percentile: taken.length
      ? Math.round(matchedRandomPercentile(rows.map((r) => ({ session: r.session, value: r.net, take: r.decision === "take" })), randomDraws, seedOf(seed, "random")) * 10) / 10
      : null,
  };
}

function deltaInterval(rows: { session: string; decision: "take" | "skip"; net: number }[], seed: string, alpha: number, iterations: number): Interval | null {
  if (!rows.length) return null;
  const deltas = rows.map((r) => ({ session: r.session, value: (r.decision === "take" ? r.net : 0) - r.net }));
  return finiteInterval(sessionBootstrapMean(deltas, iterations, seedOf(seed, "bootstrap", alpha), alpha));
}

/** Length of the shortest prefix with at least `n` rows and `sessions`
    distinct sessions, or null if the rows do not reach both yet. */
export function lookSize(rows: readonly { session: string }[], n: number, sessions: number): number | null {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    seen.add(rows[i].session);
    if (i + 1 >= n && seen.size >= sessions) return i + 1;
  }
  return null;
}

export function scoreJudge(rows: readonly JudgeScoreRow[], studyId: string, rules: JudgeRules): JudgeScore {
  const seen = new Set<string>();
  const unique = [...rows].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  const resolved = unique.filter((r): r is JudgeScoreRow & { net: number } => r.net !== null && Number.isFinite(r.net));
  const all = evidenceOf(resolved, studyId, rules.bootstrap.random);
  const runningDelta = deltaInterval(resolved, studyId, 0.05, rules.bootstrap.iterations);

  let verdict: JudgeVerdictLabel = "too-early";
  let nextLook: number | null = rules.looks[0]?.resolved ?? null;
  for (let i = 0; i < rules.looks.length; i++) {
    const look = rules.looks[i];
    // The look happens at the first moment both minimums are met: the
    // shortest prefix (in decision order) with enough calls AND sessions.
    const size = lookSize(resolved, look.resolved, look.sessions);
    if (size === null) break;
    const window = resolved.slice(0, size);
    const e = evidenceOf(window, studyId, rules.bootstrap.random);
    const d = deltaInterval(window, studyId, look.alpha, rules.bootstrap.iterations);
    const takeRate = e.resolved ? e.taken / e.resolved : 0;
    const pass = d !== null && d.lo > 0 && e.percentile !== null && e.percentile >= look.percentile && e.aiNet > 0 &&
      takeRate >= rules.takeRate.min && takeRate <= rules.takeRate.max;
    const fail = (d !== null && d.hi < 0) || (e.aiNet < e.takeAllNet && (e.percentile ?? 0) < 50);
    verdict = pass ? "pass" : fail ? "fail" : "inconclusive";
    nextLook = rules.looks[i + 1]?.resolved ?? null;
    // A decided look ends the study's verdicts; later looks never overturn it.
    if (pass || fail) {
      nextLook = null;
      break;
    }
  }

  return {
    calls: unique.length,
    resolved: resolved.length,
    taken: unique.filter((r) => r.decision === "take").length,
    skipped: unique.filter((r) => r.decision === "skip").length,
    sessions: new Set(resolved.map((r) => r.session)).size,
    aiNet: all.aiNet,
    takeAllNet: all.takeAllNet,
    randomPercentile: all.percentile,
    delta: runningDelta,
    verdict,
    nextLook,
  };
}
