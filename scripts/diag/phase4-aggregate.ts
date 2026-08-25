/* Aggregate the twelve independently computed Phase 4 cells.
   This script performs no backtest and changes no statistical rule: it only
   reconstructs the cross-cell DSR/PBO and per-cell purged-CV promotion checks
   after GitHub has parallelised the expensive matched-random simulations. */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflatedSharpe, trialSharpeDispersion } from "@/lib/validation/deflatedSharpe";
import { probabilityOfBacktestOverfitting } from "@/lib/validation/pbo";
import { combinatorialPurgedCv, summariseFolds } from "@/lib/validation/purgedCv";
import { evaluatePromotion, type PromotionEvidence } from "@/lib/validation/promotionGate";

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const INPUT = arg("--input", "artifacts/cells");
const OUT = arg("--out", "docs/research/phase4-hypotheses.json");

interface CellResult {
  trial: string;
  strategyId: string;
  symbol: string;
  params: Record<string, unknown>;
  hypothesis: string;
  prediction: string;
  trades: number;
  grossTotal: number;
  netTotal: number;
  netPerTrade: number | null;
  avgR: number;
  pf: number;
  randomEntryPercentile: number | null;
  realisedNRatio: number | null;
  [key: string]: unknown;
}

interface CellEvidence {
  kind: "phase4-cell";
  generatedFrom: string;
  measuredAt: string;
  barSource: string;
  iterations: number;
  candidateTrials: number;
  totalTrials: number;
  overnight: Array<Record<string, unknown> & { symbol: string }>;
  result: CellResult;
  measurement: {
    rMultiples: number[];
    pnl: number[];
    intervals: Array<{ t0: number; t1: number }>;
    dailyR: Record<string, number>;
  };
}

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : entry.name.endsWith(".json") ? [child] : [];
  });
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  return Math.sqrt(xs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / xs.length);
}

function main() {
  const parts = filesBelow(INPUT).map(
    (path) => JSON.parse(readFileSync(path, "utf8")) as CellEvidence,
  );
  if (parts.length !== 12 || parts.some((part) => part.kind !== "phase4-cell")) {
    throw new Error(`Expected 12 Phase 4 cell files, received ${parts.length}.`);
  }
  const first = parts[0];
  const inconsistent = parts.some(
    (part) =>
      part.barSource !== first.barSource ||
      part.iterations !== first.iterations ||
      part.totalTrials !== first.totalTrials ||
      part.candidateTrials !== first.candidateTrials,
  );
  if (inconsistent) throw new Error("Phase 4 cells disagree on source, iterations or trial count.");

  const keys = parts.map((part) => `${part.result.trial}|${part.result.symbol}`);
  if (new Set(keys).size !== 12) throw new Error("Phase 4 cells contain duplicate trial/symbol keys.");
  const byTrial = new Map<string, Set<string>>();
  for (const part of parts) {
    const symbols = byTrial.get(part.result.trial) ?? new Set<string>();
    symbols.add(part.result.symbol);
    byTrial.set(part.result.trial, symbols);
  }
  if (
    byTrial.size !== first.candidateTrials ||
    [...byTrial.values()].some((symbols) => symbols.size !== 2 || !symbols.has("MES") || !symbols.has("MNQ"))
  ) {
    throw new Error("Every preregistered configuration must have one MES and one MNQ cell.");
  }

  parts.sort((a, b) => keysFor(a).localeCompare(keysFor(b)));
  const sharpes = parts.map((part) => {
    const rs = part.measurement.rMultiples;
    return rs.length > 1 ? part.result.avgR / Math.max(1e-9, stdev(rs)) : 0;
  });
  const dispersion = trialSharpeDispersion(sharpes.filter(Number.isFinite));
  const days = [...new Set(parts.flatMap((part) => Object.keys(part.measurement.dailyR)))].sort();
  const aligned = parts.map((part) => days.map((day) => part.measurement.dailyR[day] ?? 0));
  const pbo =
    aligned.length >= 2 && days.length >= 64
      ? probabilityOfBacktestOverfitting(aligned, { splits: 8 })
      : null;

  const results = parts.map((part) => {
    const measured = part.measurement;
    const deflated =
      measured.rMultiples.length > 2
        ? deflatedSharpe(measured.rMultiples, first.totalTrials, dispersion)
        : null;
    const folds = combinatorialPurgedCv(measured.intervals, 6, 2);
    const foldExpectancy = folds
      .map((fold) =>
        fold.test.length
          ? fold.test.reduce((sum, index) => sum + measured.pnl[index], 0) / fold.test.length
          : NaN,
      )
      .filter(Number.isFinite);
    const oosNetExpectancy = foldExpectancy.length
      ? foldExpectancy.reduce((sum, value) => sum + value, 0) / foldExpectancy.length
      : null;
    const cvFoldSurvival = foldExpectancy.length
      ? foldExpectancy.filter((value) => value > 0).length / foldExpectancy.length
      : null;
    const evidence: PromotionEvidence = {
      randomEntryPercentile: part.result.randomEntryPercentile,
      deflated,
      pbo,
      oosNetExpectancy,
      cvFoldSurvival,
      trades: part.result.trades,
    };
    return {
      ...part.result,
      deflatedSharpe: deflated,
      pbo,
      oosNetExpectancy,
      cvFoldSurvival,
      cvSummary: summariseFolds(folds, measured.intervals.length),
      gate: evaluatePromotion(evidence),
    };
  });

  const best = results.reduce((winner, result) =>
    result.avgR > winner.avgR ? result : winner,
  );
  const overnight = [...new Map(parts.flatMap((part) => part.overnight).map((row) => [row.symbol, row])).values()]
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const measuredAt = parts.map((part) => part.measuredAt).sort().at(-1)!;
  const payload = {
    generatedFrom: "scripts/diag/phase4.ts + scripts/diag/phase4-aggregate.ts",
    measuredAt,
    barSource: first.barSource,
    iterations: first.iterations,
    priorTrials: Math.max(0, first.totalTrials - first.candidateTrials),
    candidateTrials: first.candidateTrials,
    totalTrials: first.totalTrials,
    trialSharpeDispersion: dispersion,
    overnight,
    trials: results,
    bestTrial: best.trial,
    deflatedSharpe: best.deflatedSharpe,
    pbo,
    cvSummary: best.cvSummary,
    notTested: [
      {
        candidate: "Time-series momentum (Moskowitz, Ooi & Pedersen 2012)",
        reason:
          "Multi-week to multi-month holding. The engine flattens every session at 15:25 and has no multi-day holding path. Testing it is an engine change, not a strategy addition.",
      },
      {
        candidate: "Order-flow imbalance (Cont, Kukanov & Stoikov 2014)",
        reason:
          "Real, but decays in seconds. The archive is 5-minute bars, so the effect is over before the first bar closes. Not testable on this data at any parameter setting.",
      },
    ],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const promoted = results.filter((result) => result.gate.promote).length;
  console.log(`Aggregated ${results.length} cells; ${promoted} clear the promotion gate.`);
  console.log(`Wrote ${OUT}`);
}

const keysFor = (part: CellEvidence) => `${part.result.trial}|${part.result.symbol}`;

main();
