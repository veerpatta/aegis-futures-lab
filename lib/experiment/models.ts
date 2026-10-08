/* Decision rules the experiment can run.

   v1 "take every eligible idea" is the frozen control — the trial account's
   rule. Challengers are small logistic filters on the experiment's own
   outcomes, built from winprob's featurizers. A model may only decide take or
   skip on an idea a registered method produced: it cannot create a trade,
   change a stop, a target or a size, or touch the risk limits. */

import { FEATURE_NAMES, featurize, normalizerOf, predictProba, type ModelRow, type Normalizer } from "@/scripts/engine/winprob";
import { featuresV2 } from "@/scripts/engine/winprob-v2";
import { stableHash } from "./hash";
import { toModelRow } from "./features";
import type { ChallengerSpec, FrozenFeatures, LogitArtifact, ModelArtifact, TakeAllArtifact } from "./types";

export const TAKE_ALL_V1: TakeAllArtifact = Object.freeze({
  schema: "aegis-exp-model/1",
  kind: "take_all",
  id: "v1-take-all",
  rule: "Take every eligible idea the Ideas tab shows; the risk limits still apply.",
}) as TakeAllArtifact;

const ITERATIONS = 400;
const LEARNING_RATE = 0.1;

const V2_EXTRA = [
  "symbol:MES", "symbol:MNQ",
  ...["zone-v5", "rsi-reversion", "vwap-reversion", "orb", "bollinger-breakout", "zone-rejection-v2", "rsi-context-v2", "vwap-pullback-v1"].map((s) => `strategy:${s}`),
  "overnight", "atrPct", "atrPctMissing", "vwapAtr", "vwapAtrMissing",
];
export const FEATURE_SETS: Record<"v1" | "v2", string[]> = {
  v1: [...FEATURE_NAMES],
  v2: [...FEATURE_NAMES, ...V2_EXTRA],
};

/** winprob.trainLogit with the L2 strength as a parameter (bias unregularised).
    tests pin trainLogitL2(X, y, 1e-3) equal to trainLogit. */
export function trainLogitL2(X: number[][], y: number[], l2: number): number[] {
  const dim = X[0]?.length ?? FEATURE_NAMES.length;
  const w = new Array(dim).fill(0);
  const n = X.length;
  if (!n) return w;
  for (let it = 0; it < ITERATIONS; it++) {
    const grad = new Array(dim).fill(0);
    for (let i = 0; i < n; i++) {
      const err = predictProba(w, X[i]) - y[i];
      for (let j = 0; j < dim; j++) grad[j] += err * X[i][j];
    }
    for (let j = 0; j < dim; j++) w[j] -= LEARNING_RATE * (grad[j] / n + (j === 0 ? 0 : l2 * w[j]));
  }
  return w;
}

export function featuresFor(set: "v1" | "v2", row: ModelRow, norm: Normalizer): number[] {
  return set === "v1" ? featurize(row, norm) : featuresV2(row, norm);
}

export interface TrainRow {
  features: FrozenFeatures;
  win: 0 | 1;
  /** Net dollars of the one-trade standalone outcome. */
  net: number;
  sessionKey: string;
}

/** Keep the most recent `windowSessions` sessions (all when null). */
export function windowRows<T extends { sessionKey: string }>(rows: T[], windowSessions: number | null): T[] {
  if (windowSessions === null) return rows;
  const sessions = [...new Set(rows.map((r) => r.sessionKey))].sort();
  const keep = new Set(sessions.slice(-windowSessions));
  return rows.filter((r) => keep.has(r.sessionKey));
}

/** Break-even probability: take an idea when p·avgWin > (1−p)·avgLoss. */
export function evThreshold(rows: { net: number }[]): { tau: number; avgWin: number; avgLoss: number } {
  const wins = rows.filter((r) => r.net > 0), losses = rows.filter((r) => r.net <= 0);
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.net, 0) / wins.length : 0;
  const avgLoss = losses.length ? -losses.reduce((a, r) => a + r.net, 0) / losses.length : 0;
  const tau = avgWin + avgLoss > 0 ? avgLoss / (avgWin + avgLoss) : 0.5;
  return { tau: Math.min(0.95, Math.max(0.05, tau)), avgWin, avgLoss };
}

export interface FittedLogit {
  coefficients: number[];
  normalizer: Normalizer;
  tau: number;
  avgWin: number;
  avgLoss: number;
  n: number;
}

export function fitLogit(spec: ChallengerSpec, rows: TrainRow[]): FittedLogit {
  const train = windowRows(rows, spec.windowSessions);
  const modelRows = train.map((r) => toModelRow(r.features));
  const normalizer = normalizerOf(modelRows);
  const coefficients = trainLogitL2(modelRows.map((r) => featuresFor(spec.featureSet, r, normalizer)), train.map((r) => r.win), spec.l2);
  return { coefficients, normalizer, ...evThreshold(train), n: train.length };
}

export function trainChallenger(
  id: string, spec: ChallengerSpec, rows: TrainRow[], meta: { seed: number; cutoff: string; datasetId: string | null; rowsHash: string },
  fitModel: typeof fitLogit = fitLogit,
): LogitArtifact {
  const fit = fitModel(spec, rows);
  const sessions = windowRows(rows, spec.windowSessions).map((r) => r.sessionKey).sort();
  return {
    schema: "aegis-exp-model/1", kind: "logit", id, featureSet: spec.featureSet, featureNames: FEATURE_SETS[spec.featureSet],
    coefficients: fit.coefficients, normalizer: fit.normalizer, l2: spec.l2, windowSessions: spec.windowSessions, seed: meta.seed,
    threshold: { rule: "ev-breakeven", tau: fit.tau, avgWin: fit.avgWin, avgLoss: fit.avgLoss },
    train: { n: fit.n, from: sessions[0] ?? null, to: sessions.at(-1) ?? null, cutoff: meta.cutoff, datasetId: meta.datasetId, rowsHash: meta.rowsHash },
  };
}

const CANON: FrozenFeatures = {
  tier: "A", regime: "trend-high-vol", vix_bucket: "low", score: 1, rr: 2, signal_ts: "2026-10-07T14:00:00.000Z",
  symbol: "MES", strategy: "zone-v5", atr_pct: 0.1, vwap_atr: 0.5,
};

/** Problems with an artifact; an empty list means it is safe to run. */
export function validateArtifact(a: ModelArtifact | null | undefined): string[] {
  if (!a || a.schema !== "aegis-exp-model/1") return ["unknown model format"];
  if (a.kind === "take_all") return a.id ? [] : ["missing id"];
  if (a.kind !== "logit") return ["unknown model kind"];
  const problems: string[] = [];
  const names = FEATURE_SETS[a.featureSet];
  if (!names) return ["unknown feature set"];
  if (a.featureNames.length !== names.length || a.featureNames.some((n, i) => n !== names[i])) problems.push("feature names do not match");
  const width = featuresFor(a.featureSet, toModelRow(CANON), a.normalizer).length;
  if (a.coefficients.length !== width) problems.push("coefficient count does not match the features");
  if (!a.coefficients.every(Number.isFinite)) problems.push("a coefficient is not a number");
  const n = a.normalizer;
  if (![n.scoreMean, n.scoreStd, n.rrMean, n.rrStd].every(Number.isFinite) || n.scoreStd <= 0 || n.rrStd <= 0) problems.push("bad normalizer");
  if (!(a.threshold.tau > 0 && a.threshold.tau < 1)) problems.push("threshold outside 0–1");
  return problems;
}

export const artifactHash = (a: ModelArtifact): string => stableHash(a);

export class ModelOutputError extends Error {}

/** Score an idea. Take-all always takes. A logit model takes when p ≥ τ.
    Throws ModelOutputError when the model produces an unusable number. */
export function scoreOpportunity(a: ModelArtifact, f: FrozenFeatures): { p: number | null; take: boolean; threshold: number | null } {
  if (a.kind === "take_all") return { p: null, take: true, threshold: null };
  const p = predictProba(a.coefficients, featuresFor(a.featureSet, toModelRow(f), a.normalizer));
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new ModelOutputError(`model ${a.id} produced ${p}`);
  return { p, take: p >= a.threshold.tau, threshold: a.threshold.tau };
}
