/* The historical study's evaluation. Pure and seeded.

   Per registered trial (at most three, fixed in the manifest):
   1. Fold coverage on the development period — all five expanding folds must
      be valid, or the trial fails explicitly.
   2. Development walk-forward: refit per fold (normaliser and threshold fitted
      on training rows only), predict the fold's test sessions.
   3. Validation: fit on everything before the validation period (exit-time
      embargo), predict validation once.
   Selection: highest validation lower bound of the gain over the incumbent.
   4. Final: the selected specification is fitted ONCE on development +
      validation, frozen as an artifact, and scored ONCE on the final period.
      Every period was inspected by earlier research, so the result is labelled
      development-exposed and never counts as fresh evidence.

   Compared on the same ideas with: the frozen take-every-idea incumbent, a
   training base-rate predictor, no-trade $0, and matched seeded random picks;
   plus an end-to-end portfolio simulation under identical risk limits,
   doubled costs, Brier score and log loss with reliability bins. */

import { predictProba } from "@/scripts/engine/winprob";
import { featuresFor, fitLogit, trainChallenger, validateArtifact, type TrainRow } from "@/lib/experiment/models";
import { toModelRow } from "@/lib/experiment/features";
import { verdictOf, type EvalRow, type Metrics, type VerdictResult } from "@/lib/experiment/evaluate";
import { brier, matchedRandomPercentile, maxDrawdown, sessionBootstrapMean, stressDrawdownP95 } from "@/lib/experiment/stats";
import { sizeExperimentTrade, EXP_RISK } from "@/lib/experiment/policy";
import { seedOf, stableHash } from "@/lib/experiment/hash";
import { PREREG } from "@/lib/experiment/prereg";
import { specHash } from "@/lib/experiment/search";
import type { ChallengerSpec, LogitArtifact } from "@/lib/experiment/types";
import { HIST_RULES } from "./rules";
import { foldReport, rowsIn, trainingFor, type FoldReport, type RowExtra, type Split } from "./dataset";
export type { RowExtra } from "./dataset";

export interface Reliability {
  bin: number;
  meanPredicted: number;
  actual: number;
  n: number;
}

export interface PeriodMetrics extends Metrics {
  logLossC: number;
  logLossBase: number;
  brierBase: number;
  reliability: Reliability[];
  selected: number;
  costs: number;
  portfolio: { candidate: { net: number; maxDrawdown: number; trades: number }; incumbent: { net: number; maxDrawdown: number; trades: number } };
}

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logLoss = (ps: number[], ys: number[]) => (ps.length ? -ps.reduce((a, p, i) => a + (ys[i] ? Math.log(clampP(p)) : Math.log(1 - clampP(p))), 0) / ps.length : NaN);

function reliability(ps: number[], ys: number[]): Reliability[] {
  if (ps.length < 50) return [];
  const idx = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b]);
  const per = idx.length / 10;
  const out: Reliability[] = [];
  for (let b = 0; b < 10; b++) {
    const s = idx.slice(Math.floor(b * per), Math.floor((b + 1) * per));
    if (!s.length) continue;
    out.push({ bin: b + 1, meanPredicted: +(s.reduce((a, i) => a + ps[i], 0) / s.length).toFixed(3), actual: +(s.reduce((a, i) => a + ys[i], 0) / s.length).toFixed(3), n: s.length });
  }
  return out;
}

/** End-to-end virtual account under the learner's risk limits (sizing at fill risk; marks only at exits). */
export function portfolioSim(rows: EvalRow[], take: boolean[], extras: Map<string, RowExtra>): { net: number; maxDrawdown: number; trades: number } {
  let realized = 0, peak: number = EXP_RISK.capital, maxDd = 0, trades = 0, locked = false, dayHalted = false;
  let day = "", dayStart: number = EXP_RISK.capital;
  let open: { exit: number; net: number; risk: number }[] = [];
  const settle = (until: number) => {
    const done = open.filter((p) => p.exit <= until);
    open = open.filter((p) => p.exit > until);
    for (const p of done.sort((a, b) => a.exit - b.exit)) {
      realized += p.net;
      const equity = EXP_RISK.capital + realized;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
      if (peak - equity >= EXP_RISK.maxDrawdown) locked = true;
      if (equity - dayStart <= -EXP_RISK.dailyLoss) dayHalted = true;
    }
  };
  const order = rows.map((r, i) => i).sort((a, b) => rows[a].decidedAt - rows[b].decidedAt);
  for (const i of order) {
    const r = rows[i];
    settle(r.decidedAt);
    if (r.session !== day) { day = r.session; dayStart = EXP_RISK.capital + realized; dayHalted = false; }
    if (!take[i] || locked || dayHalted) continue;
    const ex = extras.get(r.key);
    const risk = ex?.riskPc ?? null;
    if (!risk || !(risk > 0)) continue;
    const equity = EXP_RISK.capital + realized;
    const sized = sizeExperimentTrade({ equity, peak, dailyPnl: equity - dayStart, openRisk: open.reduce((a, p) => a + p.risk, 0), locked, dayHalted }, risk);
    if (sized.qty < 1) continue;
    open.push({ exit: r.exitTs, net: sized.qty * r.netPerContract, risk: sized.qty * risk });
    trades++;
  }
  settle(Infinity);
  return { net: Math.round(realized * 100) / 100, maxDrawdown: Math.round(maxDd * 100) / 100, trades };
}

/** Metrics on one test set, matched against the incumbent and the controls. */
export function periodMetrics(
  test: EvalRow[], pC: number[], tau: number, baseRate: number, extras: Map<string, RowExtra>, seedKey: string, comparisons: number, prereg = PREREG,
): PeriodMetrics {
  const takeC = pC.map((p) => p >= tau);
  const alpha = prereg.gates.alpha / Math.max(1, comparisons);
  const seeds = { boot: seedOf(HIST_RULES.seed, seedKey, "boot"), rand: seedOf(HIST_RULES.seed, seedKey, "rand"), stress: seedOf(HIST_RULES.seed, seedKey, "stress") };
  const c = test.map((r, i) => ({ session: r.session, value: takeC[i] ? r.net : 0 }));
  const d = test.map((r, i) => ({ session: r.session, value: (takeC[i] ? r.net : 0) - r.net }));
  const ys = test.map((r) => r.win);
  const base = test.map(() => baseRate);
  return {
    nOos: test.length,
    nSessions: new Set(test.map((r) => r.session)).size,
    folds: 0,
    delta: sessionBootstrapMean(d, prereg.gates.bootstrapB, seeds.boot, alpha),
    expectancy: sessionBootstrapMean(c, prereg.gates.bootstrapB, seeds.boot + 1, alpha),
    randomPct: matchedRandomPercentile(test.map((r, i) => ({ session: r.session, value: r.net, take: takeC[i] })), prereg.gates.randomR, seeds.rand),
    stressP95: stressDrawdownP95(c, prereg.gates.stressR, seeds.stress),
    costStressNet: test.reduce((a, r, i) => a + (takeC[i] ? r.standaloneQty * (r.netPerContract - r.frictionPerContract) : 0), 0),
    brierC: brier(pC, ys),
    brierInc: brier(base, ys),
    brierBase: brier(base, ys),
    logLossC: logLoss(pC, ys),
    logLossBase: logLoss(base, ys),
    reliability: reliability(pC, ys),
    takeRate: test.length ? takeC.filter(Boolean).length / test.length : NaN,
    selected: takeC.filter(Boolean).length,
    costs: Math.round(test.reduce((a, r, i) => a + (takeC[i] ? r.standaloneQty * r.frictionPerContract : 0), 0) * 100) / 100,
    chalNet: Math.round(c.reduce((a, x) => a + x.value, 0) * 100) / 100,
    incNet: Math.round(test.reduce((a, r) => a + r.net, 0) * 100) / 100,
    maxDrawdown: maxDrawdown(c.map((x) => x.value)),
    alpha,
    portfolio: { candidate: portfolioSim(test, takeC, extras), incumbent: portfolioSim(test, test.map(() => true), extras) },
  };
}

const toTrain = (r: EvalRow): TrainRow => ({ features: r.features, win: r.win, net: r.net, sessionKey: r.session });

function predictAll(spec: ChallengerSpec, train: EvalRow[], test: EvalRow[]) {
  const fit = fitLogit({ ...spec, windowSessions: null }, train.map(toTrain));
  const p = test.map((r) => predictProba(fit.coefficients, featuresFor(spec.featureSet, toModelRow(r.features), fit.normalizer)));
  const baseRate = train.length ? train.reduce((a, r) => a + r.win, 0) / train.length : 0.5;
  return { fit, p, baseRate };
}

export interface TrialResult {
  spec: ChallengerSpec;
  specHash: string;
  ordinal: number;
  status: "evaluated" | "failed_coverage" | "invalid";
  folds: FoldReport[];
  coverageReason: string | null;
  development: PeriodMetrics | null;
  validation: PeriodMetrics | null;
  reason: string | null;
}

export function evaluateTrial(spec: ChallengerSpec, ordinal: number, rows: EvalRow[], split: Split, extras: Map<string, RowExtra>, comparisons: number, rules = HIST_RULES): TrialResult {
  const devRows = rowsIn(rows, split.development);
  const fr = foldReport(devRows, spec.windowSessions, rules);
  const base: TrialResult = { spec, specHash: specHash(spec), ordinal, status: "failed_coverage", folds: fr.folds, coverageReason: fr.reason, development: null, validation: null, reason: fr.reason };
  if (!fr.coverage) return base;
  // Development walk-forward on the valid folds (all five, by the coverage rule).
  const oos: EvalRow[] = [], pAll: number[] = [], taus: number[] = [], bases: number[] = [];
  for (const f of fr.folds) {
    const set = new Set(devRows.filter((r) => r.session >= f.testFrom && r.session <= f.testTo).map((r) => r.key));
    const test = devRows.filter((r) => set.has(r.key));
    const testStart = Math.min(...test.map((r) => r.decidedAt));
    const { train } = trainingFor(devRows, f.testFrom, testStart, spec.windowSessions);
    const { fit, p, baseRate } = predictAll(spec, train, test);
    if (!p.every(Number.isFinite)) return { ...base, status: "invalid", reason: `fold ${f.fold} produced unusable probabilities` };
    oos.push(...test); pAll.push(...p);
    for (let i = 0; i < test.length; i++) { taus.push(fit.tau); bases.push(baseRate); }
  }
  // Per-row thresholds: take when p ≥ that fold's τ.
  const pAdj = pAll.map((p, i) => p - taus[i] + 0.5);
  const dev = periodMetrics(oos, pAdj, 0.5, bases.reduce((a, b) => a + b, 0) / Math.max(1, bases.length), extras, `${spec.featureSet}:${spec.l2}:${spec.windowSessions}:dev`, comparisons);
  // Report calibration on the raw probabilities, not the threshold-shifted ones.
  dev.brierC = brier(pAll, oos.map((r) => r.win));
  dev.logLossC = logLoss(pAll, oos.map((r) => r.win));
  dev.reliability = reliability(pAll, oos.map((r) => r.win));
  dev.brierInc = dev.brierBase = brier(bases, oos.map((r) => r.win));
  dev.logLossBase = logLoss(bases, oos.map((r) => r.win));
  dev.folds = fr.folds.length;
  // Validation once.
  const valRows = rowsIn(rows, split.validation);
  const valStart = valRows.length ? Math.min(...valRows.map((r) => r.decidedAt)) : Infinity;
  const { train: vTrain } = trainingFor(rows, split.validation.from, valStart, spec.windowSessions);
  if (vTrain.length < rules.folds.minTrainRows || !valRows.length) return { ...base, status: "failed_coverage", development: dev, reason: "validation period lacks training or test rows" };
  const v = predictAll(spec, vTrain, valRows);
  if (!v.p.every(Number.isFinite)) return { ...base, status: "invalid", development: dev, reason: "validation produced unusable probabilities" };
  const val = periodMetrics(valRows, v.p, v.fit.tau, v.baseRate, extras, `${spec.featureSet}:${spec.l2}:${spec.windowSessions}:val`, comparisons);
  return { ...base, status: "evaluated", development: dev, validation: val, reason: null };
}

/** The preregistered selection: highest validation lower bound of the gain over the incumbent. */
export function selectTrial(results: TrialResult[]): TrialResult | null {
  const ok = results.filter((r) => r.status === "evaluated" && r.validation);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => (b.validation!.delta.lo - a.validation!.delta.lo) || a.ordinal - b.ordinal)[0];
}

export interface FinalResult {
  artifact: LogitArtifact;
  artifactHash: string;
  trainCutoff: number;
  trainRows: number;
  final: PeriodMetrics;
  verdict: VerdictResult;
  developmentExposed: boolean;
  shadowEligible: boolean;
}

/** Fit the selected specification once on development + validation, freeze it, score the final period once. */
export function finalEvaluation(sel: TrialResult, rows: EvalRow[], split: Split, extras: Map<string, RowExtra>, meta: { studyId: string; datasetHash: string }, rules = HIST_RULES): FinalResult | { error: string } {
  const finRows = rowsIn(rows, split.final);
  if (!finRows.length) return { error: "final period has no rows" };
  const finStart = Math.min(...finRows.map((r) => r.decidedAt));
  const { train } = trainingFor(rows, split.final.from, finStart, sel.spec.windowSessions);
  if (train.length < rules.folds.minTrainRows) return { error: `final fit has ${train.length} training rows (needs ${rules.folds.minTrainRows})` };
  if (train.length > rules.budget.maxExamplesPerFit) return { error: `final fit exceeds the ${rules.budget.maxExamplesPerFit}-example budget` };
  const trainCutoff = Math.max(...train.map((r) => r.exitTs));
  const artifact = trainChallenger(`${meta.studyId}:${sel.specHash.slice(0, 8)}`, sel.spec, train.map(toTrain), {
    seed: rules.seed, cutoff: new Date(trainCutoff * 1000).toISOString(), datasetId: meta.studyId, rowsHash: meta.datasetHash,
  });
  const problems = validateArtifact(artifact);
  if (problems.length) return { error: `artifact invalid: ${problems.join("; ")}` };
  const p = finRows.map((r) => predictProba(artifact.coefficients, featuresFor(artifact.featureSet, toModelRow(r.features), artifact.normalizer)));
  const baseRate = train.reduce((a, r) => a + r.win, 0) / train.length;
  const final = periodMetrics(finRows, p, artifact.threshold.tau, baseRate, extras, `${sel.specHash}:final`, 1);
  final.folds = 1;
  const verdict = verdictOf(final);
  return {
    artifact, artifactHash: stableHash(artifact), trainCutoff, trainRows: train.length, final, verdict,
    developmentExposed: rules.untouchedHistoricalPeriod === null,
    shadowEligible: rules.shadowEligibleVerdicts.includes(verdict.verdict),
  };
}
