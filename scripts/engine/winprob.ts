/* Ring 1b — win-probability model. A plain logistic regression (batch gradient
   descent, no ML deps) that predicts each signal's win probability from
   features already stored on the row. It can only ever VETO the worst signals
   (bottom decile of predicted probability) — it can never create or upsize a
   trade — and it earns that authority only after ≥300 clean-fill samples AND
   an out-of-sample Brier score that beats the base-rate baseline. Until then
   it audits in observe mode exactly like the shadow strategies.

   Everything here is deterministic (zero-initialised weights, fixed schedule)
   so a re-run reproduces the same model. Paper only, delayed data. */

import { nyMeta } from "@/lib/time/ny";
import { tradingDaysBetween } from "@/lib/time/trading-days";

export const MODEL_NAME = "winprob-logit-v1";
export const GRADUATE_MIN_TRAIN = 300; // clean-fill closed samples before active
export const EMBARGO_DAYS = 5; // TRADING-day gap between train end and test start
export const WF_FOLDS = 5; // walk-forward test folds

/** A train row is far enough from the test fold iff ≥ EMBARGO_DAYS TRADING days
    separate its entry from the test-fold start. */
export function pastEmbargo(rowSec: number, testStartSec: number): boolean {
  return tradingDaysBetween(rowSec, testStartSec) >= EMBARGO_DAYS;
}
const ITERATIONS = 400;
const LEARNING_RATE = 0.1;
const L2 = 1e-3;

/* A row the model can featurise — the intersection of signals & shadow_signals. */
export interface ModelRow {
  tier: string | null;
  regime: string | null;
  vix_bucket: string | null;
  score: number | null;
  rr: number | null;
  signal_ts: string;
  pnl_usd: number | null;
  fill_confidence: string | null;
}

const REGIMES = ["trend-high-vol", "trend-low-vol", "range-high-vol", "range-low-vol"];

/* Fixed feature layout — coefficients map to these names in order (index 0 is
   the bias). score & rr are standardised with the training mean/std stored on
   the model so predictions use the identical transform. */
export const FEATURE_NAMES = [
  "bias",
  "tierB",
  ...REGIMES.map((r) => `regime:${r}`),
  "vixHigh",
  "scoreZ",
  "scoreMissing",
  "rrZ",
  "rrMissing",
  "hour:8-10",
  "hour:10-12",
  "hour:>=12",
  "dow:Tue",
  "dow:Wed",
  "dow:Thu",
  "dow:Fri",
] as const;

export interface Normalizer {
  scoreMean: number;
  scoreStd: number;
  rrMean: number;
  rrStd: number;
}

const hourBucket = (sec: number): number => {
  const h = nyMeta(sec).hour;
  if (h < 10) return 1; // 8-10 (session opens ~09:30 ET)
  if (h < 12) return 2; // 10-12
  return 3; // >=12
};

export function featurize(row: ModelRow, norm: Normalizer): number[] {
  const sec = Math.floor(Date.parse(row.signal_ts) / 1000);
  const wd = nyMeta(sec).weekday;
  const hb = hourBucket(sec);
  const scoreMissing = row.score === null ? 1 : 0;
  const rrMissing = row.rr === null ? 1 : 0;
  const scoreZ = row.score === null ? 0 : (row.score - norm.scoreMean) / (norm.scoreStd || 1);
  const rrZ = row.rr === null ? 0 : (row.rr - norm.rrMean) / (norm.rrStd || 1);
  return [
    1, // bias
    row.tier === "B" ? 1 : 0,
    ...REGIMES.map((r) => (row.regime === r ? 1 : 0)),
    row.vix_bucket === "high" ? 1 : 0,
    scoreZ,
    scoreMissing,
    rrZ,
    rrMissing,
    hb === 1 ? 1 : 0,
    hb === 2 ? 1 : 0,
    hb === 3 ? 1 : 0,
    wd === "Tue" ? 1 : 0,
    wd === "Wed" ? 1 : 0,
    wd === "Thu" ? 1 : 0,
    wd === "Fri" ? 1 : 0,
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const dot = (w: number[], x: number[]) => w.reduce((s, wi, i) => s + wi * x[i], 0);

export const predictProba = (w: number[], x: number[]): number => sigmoid(dot(w, x));

/** Batch gradient descent with L2. Deterministic: zero-initialised. */
export function trainLogit(X: number[][], y: number[]): number[] {
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
    for (let j = 0; j < dim; j++) {
      const reg = j === 0 ? 0 : L2 * w[j]; // don't regularise the bias
      w[j] -= LEARNING_RATE * (grad[j] / n + reg);
    }
  }
  return w;
}

const brier = (preds: number[], ys: number[]) =>
  preds.length ? preds.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / preds.length : null;

function normalizerOf(rows: ModelRow[]): Normalizer {
  const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
  const rrs = rows.map((r) => r.rr).filter((s): s is number => s !== null);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const std = (a: number[], m: number) =>
    a.length ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) : 1;
  const sm = mean(scores);
  const rm = mean(rrs);
  return { scoreMean: sm, scoreStd: std(scores, sm) || 1, rrMean: rm, rrStd: std(rrs, rm) || 1 };
}

/* Training set: closed signals with a CLEAN fill (real + shadow), ascending. */
export function trainingRows(rows: ModelRow[]): ModelRow[] {
  return rows
    .filter((r) => r.pnl_usd !== null && r.fill_confidence === "clean")
    .sort((a, b) => a.signal_ts.localeCompare(b.signal_ts));
}

const label = (r: ModelRow) => ((r.pnl_usd ?? 0) > 0 ? 1 : 0);

export interface CalibrationBin {
  bin: number;
  meanPredicted: number;
  actual: number;
  n: number;
}

export interface ModelArtifact {
  model: string;
  coefficients: number[];
  features: { names: string[]; normalizer: Normalizer };
  train_n: number;
  oos_brier: number | null;
  baseline_brier: number | null;
  calibration: CalibrationBin[];
}

/* Walk-forward, expanding window with a 5-trading-day embargo between train
   end and test start. Aggregates out-of-sample predictions across folds and
   compares Brier vs the base-rate baseline (predict the training win rate). */
export function evaluateWalkForward(training: ModelRow[]): {
  oosBrier: number | null;
  baselineBrier: number | null;
  oosPreds: number[];
  oosYs: number[];
} {
  const n = training.length;
  const oosPreds: number[] = [];
  const oosYs: number[] = [];
  const baseParts: number[] = [];
  if (n < 2 * WF_FOLDS) return { oosBrier: null, baselineBrier: null, oosPreds, oosYs };

  const foldSize = Math.floor(n / (WF_FOLDS + 1));
  for (let f = 1; f <= WF_FOLDS; f++) {
    const testStart = f * foldSize;
    const testEnd = f === WF_FOLDS ? n : (f + 1) * foldSize;
    const testRows = training.slice(testStart, testEnd);
    if (!testRows.length) continue;
    const testStartSec = Math.floor(Date.parse(testRows[0].signal_ts) / 1000);
    // Embargo in TRADING days (not calendar): a weekend-adjacent fold would
    // otherwise get only ~3 trading days of gap, leaking recent structure and
    // inflating OOS optimism that gates graduation.
    const trainRows = training
      .slice(0, testStart)
      .filter((r) => pastEmbargo(Math.floor(Date.parse(r.signal_ts) / 1000), testStartSec));
    if (trainRows.length < 20) continue;

    const norm = normalizerOf(trainRows);
    const w = trainLogit(trainRows.map((r) => featurize(r, norm)), trainRows.map(label));
    const baseRate = trainRows.reduce((s, r) => s + label(r), 0) / trainRows.length;
    for (const r of testRows) {
      const y = label(r);
      oosPreds.push(predictProba(w, featurize(r, norm)));
      oosYs.push(y);
      baseParts.push((baseRate - y) ** 2);
    }
  }
  return {
    oosBrier: brier(oosPreds, oosYs),
    baselineBrier: baseParts.length ? baseParts.reduce((s, v) => s + v, 0) / baseParts.length : null,
    oosPreds,
    oosYs,
  };
}

function calibration(preds: number[], ys: number[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  const idx = preds.map((_, i) => i).sort((a, b) => preds[a] - preds[b]);
  if (!idx.length) return bins;
  const per = idx.length / 10;
  for (let b = 0; b < 10; b++) {
    const slice = idx.slice(Math.floor(b * per), Math.floor((b + 1) * per));
    if (!slice.length) continue;
    bins.push({
      bin: b + 1,
      meanPredicted: +(slice.reduce((s, i) => s + preds[i], 0) / slice.length).toFixed(3),
      actual: +(slice.reduce((s, i) => s + ys[i], 0) / slice.length).toFixed(3),
      n: slice.length,
    });
  }
  return bins;
}

/* Train the production model on ALL training rows + attach the walk-forward
   evaluation. This is the artifact learn.ts persists to model_registry. */
export function trainModel(rows: ModelRow[]): ModelArtifact {
  const training = trainingRows(rows);
  const norm = normalizerOf(training);
  const coefficients = training.length
    ? trainLogit(training.map((r) => featurize(r, norm)), training.map(label))
    : new Array(FEATURE_NAMES.length).fill(0);
  const wf = evaluateWalkForward(training);
  return {
    model: MODEL_NAME,
    coefficients,
    features: { names: [...FEATURE_NAMES], normalizer: norm },
    train_n: training.length,
    oos_brier: wf.oosBrier === null ? null : +wf.oosBrier.toFixed(4),
    baseline_brier: wf.baselineBrier === null ? null : +wf.baselineBrier.toFixed(4),
    calibration: calibration(wf.oosPreds, wf.oosYs),
  };
}

/* Score one row with a persisted model (used by the engine to write win_prob). */
export function scoreRow(
  artifact: { coefficients: number[]; features: { normalizer: Normalizer } },
  row: ModelRow
): number {
  return predictProba(artifact.coefficients, featurize(row, artifact.features.normalizer));
}
