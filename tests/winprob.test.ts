import { describe, expect, it } from "vitest";
import {
  featurize,
  FEATURE_NAMES,
  pastEmbargo,
  predictProba,
  scoreRow,
  trainModel,
  trainingRows,
  type ModelRow,
} from "../scripts/engine/winprob";

/* The model must learn a real signal, stay deterministic, and only count
   clean-fill closed rows as training data. */

const T0 = 1_700_000_000;
const norm0 = { scoreMean: 0, scoreStd: 1, rrMean: 0, rrStd: 1 };

/* Rows where tier B wins and tier A loses — a perfectly learnable signal. */
function makeRows(n: number): ModelRow[] {
  return Array.from({ length: n }, (_, i) => {
    const tierB = i % 2 === 0;
    return {
      tier: tierB ? "B" : "A",
      regime: "trend-low-vol",
      vix_bucket: i % 3 ? "low" : "high",
      score: 50 + (i % 10),
      rr: 1.5,
      // One row per day so the walk-forward folds have room for a 5-trading-day
      // embargo between train end and test start.
      signal_ts: new Date((T0 + i * 86400) * 1000).toISOString(),
      pnl_usd: tierB ? 100 : -100,
      fill_confidence: "clean",
    } as ModelRow;
  });
}

describe("pastEmbargo — trading-day embargo (F6)", () => {
  const at = (day: string) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000);
  const testStart = at("2024-03-11"); // Monday, no US market holiday that week
  it("excludes a Friday row only 1 trading day before the Monday fold", () => {
    expect(pastEmbargo(at("2024-03-08"), testStart)).toBe(false);
  });
  it("excludes a Wed row that is 5 CALENDAR but only 3 TRADING days before (the bug)", () => {
    expect(pastEmbargo(at("2024-03-06"), testStart)).toBe(false);
  });
  it("includes a row a full 5 trading days before", () => {
    expect(pastEmbargo(at("2024-03-04"), testStart)).toBe(true);
  });
});

describe("featurize", () => {
  it("produces a vector aligned to FEATURE_NAMES with a bias term", () => {
    const x = featurize(makeRows(1)[0], norm0);
    expect(x.length).toBe(FEATURE_NAMES.length);
    expect(x[0]).toBe(1); // bias
  });
});

describe("trainingRows", () => {
  it("keeps only closed, clean-fill rows", () => {
    const rows: ModelRow[] = [
      { ...makeRows(1)[0], pnl_usd: 100, fill_confidence: "clean" },
      { ...makeRows(1)[0], pnl_usd: null, fill_confidence: "clean" }, // open
      { ...makeRows(1)[0], pnl_usd: 100, fill_confidence: "doubtful" }, // not clean
    ];
    expect(trainingRows(rows).length).toBe(1);
  });
});

describe("trainModel", () => {
  it("learns the signal: tier B scores higher than tier A", () => {
    const model = trainModel(makeRows(200))!;
    const pB = scoreRow(model, { ...makeRows(1)[0], tier: "B" });
    const pA = scoreRow(model, { ...makeRows(1)[0], tier: "A" });
    expect(pB).toBeGreaterThan(pA);
    expect(pB).toBeGreaterThan(0.5);
    expect(pA).toBeLessThan(0.5);
  });

  it("beats the base-rate baseline out-of-sample on a learnable set", () => {
    const model = trainModel(makeRows(200))!;
    expect(model.train_n).toBe(200);
    expect(model.oos_brier).not.toBeNull();
    expect(model.baseline_brier).not.toBeNull();
    expect(model.oos_brier!).toBeLessThan(model.baseline_brier!);
  });

  it("is deterministic — same data, same coefficients", () => {
    const a = trainModel(makeRows(120))!;
    const b = trainModel(makeRows(120))!;
    expect(a.coefficients).toEqual(b.coefficients);
  });

  it("refuses to emit a model with too little clean data (F7)", () => {
    expect(trainModel([])).toBeNull();
    expect(trainModel(makeRows(40))).toBeNull(); // < 50 clean rows
    expect(trainModel(makeRows(50))).not.toBeNull(); // exactly at the floor
    // never an all-zero coefficient set that would veto everything
    expect(predictProba(new Array(FEATURE_NAMES.length).fill(0), featurize(makeRows(1)[0], norm0))).toBeCloseTo(0.5);
  });
});
