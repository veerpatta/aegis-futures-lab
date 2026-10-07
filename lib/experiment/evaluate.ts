/* How a challenger is judged, adopted or rolled back. Pure and seeded.

   Walk-forward: sessions are split into six blocks; five expanding folds each
   train on everything before the test block, minus a five-trading-day embargo,
   and test on the block. Preprocessing (the normaliser) and the take threshold
   are fitted on training rows only. Every test idea is judged on the same
   ("matched") opportunity for the challenger and the frozen incumbent.

   Verdict (all must hold to pass):
   - at least 150 out-of-sample outcomes;
   - net gain over the incumbent per idea: session-bootstrap interval above 0;
   - net result per idea above the $0 no-trade baseline: interval above 0;
   - at least the 95th percentile against matched random picks;
   - 95th-percentile reshuffled drawdown under $2,000;
   - still positive with costs doubled;
   - better calibrated (lower Brier score) than the incumbent.
   An interval that still includes "no improvement" is INCONCLUSIVE, never a
   pass. Win rate alone is never a criterion. */

import { pastEmbargo } from "@/scripts/engine/winprob";
import { PREREG } from "./prereg";
import { fitLogit, featuresFor, windowRows } from "./models";
import { toModelRow } from "./features";
import { predictProba } from "@/scripts/engine/winprob";
import { brier, matchedRandomPercentile, maxDrawdown, sessionBootstrapMean, stressDrawdownP95, type Interval } from "./stats";
import { seedOf } from "./hash";
import type { ChallengerSpec, FrozenFeatures, ModelArtifact, Provenance } from "./types";

export type Verdict = "pass" | "fail" | "inconclusive" | "invalid";

export interface EvalRow {
  key: string;
  session: string;
  decidedAt: number;
  exitTs: number;
  features: FrozenFeatures;
  win: 0 | 1;
  /** Standalone net dollars ($100 of risk on its own). */
  net: number;
  netPerContract: number;
  frictionPerContract: number;
  standaloneQty: number;
  provenance: Provenance;
}

export interface OosRow {
  key: string;
  session: string;
  u: number;
  stressU: number;
  takeC: boolean;
  takeInc: boolean;
  pC: number;
  pInc: number;
  y: number;
}

export interface Metrics {
  nOos: number;
  nSessions: number;
  folds: number;
  delta: Interval;
  expectancy: Interval;
  randomPct: number;
  stressP95: number;
  costStressNet: number;
  brierC: number;
  brierInc: number;
  takeRate: number;
  chalNet: number;
  incNet: number;
  maxDrawdown: number;
  alpha: number;
}

export interface WalkForwardResult {
  oos: OosRow[];
  metrics: Metrics;
  seeds: { bootstrap: number; random: number; stress: number };
}

const trainRow = (r: EvalRow) => ({ features: r.features, win: r.win, net: r.net, sessionKey: r.session });

/** Rows that may serve as evidence. Late catch-up and synthetic rows never do
    (synthetic only inside a synthetic campaign, for software tests). */
export function evidenceRows(rows: EvalRow[], allowSynthetic = false): EvalRow[] {
  return rows.filter((r) => r.provenance === "prospective" || r.provenance === "replay" || (allowSynthetic && r.provenance === "synthetic"));
}

function incumbentDecision(inc: ModelArtifact, r: EvalRow, baseRate: number): { take: boolean; p: number } {
  if (inc.kind === "take_all") return { take: true, p: baseRate };
  const p = predictProba(inc.coefficients, featuresFor(inc.featureSet, toModelRow(r.features), inc.normalizer));
  return { take: p >= inc.threshold.tau, p };
}

export function walkForward(
  allRows: EvalRow[], spec: ChallengerSpec, incumbent: ModelArtifact,
  opts: { seedKey: string; comparisons: number; allowSynthetic?: boolean; prereg?: typeof PREREG },
): WalkForwardResult {
  const prereg = opts.prereg ?? PREREG;
  const rows = [...allRows].sort((a, b) => a.decidedAt - b.decidedAt || a.key.localeCompare(b.key));
  const evidence = new Set(evidenceRows(rows, opts.allowSynthetic).map((r) => r.key));
  const sessions = [...new Set(rows.map((r) => r.session))].sort();
  const foldSize = Math.floor(sessions.length / (prereg.gates.folds + 1));
  const oos: OosRow[] = [];
  let folds = 0;
  const incCutoff = incumbent.kind === "logit" ? Date.parse(incumbent.train.cutoff) / 1000 : -Infinity;
  if (foldSize >= 1) {
    for (let f = 1; f <= prereg.gates.folds; f++) {
      const testSessions = new Set(sessions.slice(f * foldSize, f === prereg.gates.folds ? undefined : (f + 1) * foldSize));
      const test = rows.filter((r) => testSessions.has(r.session) && evidence.has(r.key));
      if (!test.length) continue;
      const testStart = Math.min(...test.map((r) => r.decidedAt));
      const firstTestSession = [...testSessions].sort()[0];
      const train = windowRows(
        rows.filter((r) => r.session < firstTestSession && pastEmbargo(r.exitTs, testStart)).map(trainRow),
        spec.windowSessions,
      );
      if (train.length < prereg.gates.minTrainRows) continue;
      folds++;
      const fit = fitLogit({ ...spec, windowSessions: null }, train);
      const baseRate = train.reduce((a, r) => a + r.win, 0) / train.length;
      for (const r of test) {
        // A frozen logit incumbent is only compared on ideas after its own training cutoff.
        if (incumbent.kind === "logit" && !pastEmbargo(incCutoff, r.decidedAt)) continue;
        const pC = predictProba(fit.coefficients, featuresFor(spec.featureSet, toModelRow(r.features), fit.normalizer));
        const inc = incumbentDecision(incumbent, r, baseRate);
        oos.push({
          key: r.key, session: r.session, u: r.net, stressU: r.standaloneQty * (r.netPerContract - r.frictionPerContract),
          takeC: pC >= fit.tau, takeInc: inc.take, pC, pInc: inc.p, y: r.win,
        });
      }
    }
  }
  const alpha = prereg.gates.alpha / Math.max(1, opts.comparisons);
  const seeds = { bootstrap: seedOf(prereg.seed, opts.seedKey, "boot"), random: seedOf(prereg.seed, opts.seedKey, "rand"), stress: seedOf(prereg.seed, opts.seedKey, "stress") };
  const c = oos.map((o) => ({ session: o.session, value: o.takeC ? o.u : 0 }));
  const d = oos.map((o) => ({ session: o.session, value: (o.takeC ? o.u : 0) - (o.takeInc ? o.u : 0) }));
  const metrics: Metrics = {
    nOos: oos.length,
    nSessions: new Set(oos.map((o) => o.session)).size,
    folds,
    delta: sessionBootstrapMean(d, prereg.gates.bootstrapB, seeds.bootstrap, alpha),
    expectancy: sessionBootstrapMean(c, prereg.gates.bootstrapB, seeds.bootstrap + 1, alpha),
    randomPct: matchedRandomPercentile(oos.map((o) => ({ session: o.session, value: o.u, take: o.takeC })), prereg.gates.randomR, seeds.random),
    stressP95: stressDrawdownP95(c, prereg.gates.stressR, seeds.stress),
    costStressNet: oos.reduce((a, o) => a + (o.takeC ? o.stressU : 0), 0),
    brierC: brier(oos.map((o) => o.pC), oos.map((o) => o.y)),
    brierInc: brier(oos.map((o) => o.pInc), oos.map((o) => o.y)),
    takeRate: oos.length ? oos.filter((o) => o.takeC).length / oos.length : NaN,
    chalNet: c.reduce((a, r) => a + r.value, 0),
    incNet: oos.reduce((a, o) => a + (o.takeInc ? o.u : 0), 0),
    maxDrawdown: maxDrawdown(c.map((r) => r.value)),
    alpha,
  };
  return { oos, metrics, seeds };
}

export interface VerdictResult {
  verdict: Verdict;
  reasons: string[];
  checks: Record<string, boolean>;
}

/** The verdict and the checks behind it, in plain codes the UI words. */
export function verdictOf(m: Metrics, prereg = PREREG): VerdictResult {
  const finite = [m.delta.est, m.expectancy.est, m.brierC, m.brierInc].every(Number.isFinite);
  if (m.nOos > 0 && !finite) return { verdict: "invalid", reasons: ["numbers-invalid"], checks: {} };
  const checks = {
    enoughOutcomes: m.nOos >= prereg.gates.minOos,
    beatsIncumbent: m.delta.lo > 0,
    beatsNoTrade: m.expectancy.lo > 0,
    beatsRandom: m.randomPct >= prereg.gates.randomPct,
    drawdownOk: m.stressP95 < prereg.gates.stressDrawdown,
    survivesDoubleCosts: m.costStressNet > 0,
    betterCalibrated: m.brierC < m.brierInc,
  };
  const reasons = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (!reasons.length) return { verdict: "pass", reasons: [], checks };
  if (!checks.enoughOutcomes) return { verdict: "inconclusive", reasons, checks };
  const clearlyWorse = m.delta.hi < 0 || m.expectancy.hi < 0 || !checks.drawdownOk || (!checks.betterCalibrated && m.nOos >= prereg.gates.minOos);
  return { verdict: clearlyWorse ? "fail" : "inconclusive", reasons, checks };
}

export interface ReviewRecord {
  at: number;
  verdict: Verdict;
  /** Closed outcomes added since the review before it. */
  newOutcomes: number;
}

export interface FreshWindow {
  sessions: number;
  decisions: number;
  deltaPerIdea: number;
  netPerIdea: number;
}

/** Adopt only when the current review passes, the challenger has also earned a
    fresh confirmation window after it was registered, and a previous review of
    the same challenger at least six days earlier passed too — each review
    with at least ten new closed outcomes. */
export function adoptionDecision(input: {
  current: ReviewRecord; previous: ReviewRecord[]; fresh: FreshWindow; active: boolean; prereg?: typeof PREREG;
}): { adopt: boolean; reasons: string[] } {
  const g = (input.prereg ?? PREREG).gates;
  const reasons: string[] = [];
  if (!input.active) reasons.push("experiment-not-active");
  if (input.current.verdict !== "pass") reasons.push("current-review-not-passed");
  if (input.current.newOutcomes < g.minNewOutcomes) reasons.push("too-few-new-outcomes");
  const earlier = input.previous
    .filter((p) => p.verdict === "pass" && p.newOutcomes >= g.minNewOutcomes && input.current.at - p.at >= g.reviewGapDays * 86400)
    .sort((a, b) => b.at - a.at)[0];
  if (!earlier) reasons.push("needs-second-passing-review");
  if (input.fresh.sessions < g.freshSessions) reasons.push("fresh-sessions-short");
  if (input.fresh.decisions < g.freshDecisions) reasons.push("fresh-decisions-short");
  if (!(input.fresh.deltaPerIdea > 0)) reasons.push("fresh-no-gain");
  if (!(input.fresh.netPerIdea > 0)) reasons.push("fresh-not-positive");
  return { adopt: reasons.length === 0, reasons };
}

/** Preregistered rollback rule for an adopted model (not for v1). */
export function rollbackDecision(input: {
  post: { session: string; delta: number; net: number }[];
  brierRegressions: number;
  seedKey: string;
  prereg?: typeof PREREG;
}): { rollback: boolean; reason: string | null; delta?: Interval; drawdown: number } {
  const p = input.prereg ?? PREREG;
  const drawdown = maxDrawdown(input.post.map((r) => r.net));
  if (drawdown >= p.rollback.drawdownStop) return { rollback: true, reason: "post-adoption-drawdown", drawdown };
  if (input.post.length >= p.rollback.minPost) {
    const delta = sessionBootstrapMean(input.post.map((r) => ({ session: r.session, value: r.delta })), p.gates.bootstrapB, seedOf(p.seed, input.seedKey, "rollback"), p.gates.alpha);
    if (delta.hi < 0) return { rollback: true, reason: "worse-than-control", delta, drawdown };
    if (input.brierRegressions >= p.rollback.brierNights) return { rollback: true, reason: "calibration-worse", delta, drawdown };
    return { rollback: false, reason: null, delta, drawdown };
  }
  return { rollback: false, reason: null, drawdown };
}
