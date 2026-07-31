/* The promotion gate. Nothing reaches `paper` without clearing all of it.
 *
 * The brief's rule: DSR still significant after the trial-count correction,
 * survival across purged CV folds, and positive expectancy NET OF MODELLED
 * COSTS out of sample. Plus, from Phase 1, the condition that refuted the
 * incumbent streams: the entry has to beat matched random entries.
 *
 * DESIGN NOTE — the gate returns every check, not just the verdict. A gate
 * that answers "no" without saying which check failed invites the failure
 * mode this whole codebase exists to prevent: relaxing checks one at a time
 * until something passes. Each check carries its own measured value and
 * threshold so a reader can see exactly how far short a candidate fell, and
 * `evidenceGaps` distinguishes "measured and failed" from "never measured" —
 * they are not the same, and treating an unmeasured check as a pass is how a
 * gate becomes decoration.
 */

import { DSR_THRESHOLD, HLZ_T_HURDLE, type DeflatedSharpeResult } from "./deflatedSharpe";
import { PBO_THRESHOLD, type PboResult } from "./pbo";

export type GateStatus = "pass" | "fail" | "not-measured";

export interface GateCheck {
  key: string;
  label: string;
  status: GateStatus;
  value: number | null;
  threshold: number;
  detail: string;
}

export interface PromotionEvidence {
  /** Percentile of the real result in its matched random-entry null, 0-100. */
  randomEntryPercentile?: number | null;
  deflated?: DeflatedSharpeResult | null;
  pbo?: PboResult | null;
  /** Out-of-sample expectancy per trade, NET of modelled costs. */
  oosNetExpectancy?: number | null;
  /** Share of purged-CV folds with positive net expectancy, 0-1. */
  cvFoldSurvival?: number | null;
  /** Closed trades behind the evidence. */
  trades?: number | null;
}

/** The thresholds, in one place so a report can print them beside the values. */
export const GATE = {
  randomEntryPercentile: 95,
  dsr: DSR_THRESHOLD,
  tStat: HLZ_T_HURDLE,
  pbo: PBO_THRESHOLD,
  oosNetExpectancy: 0,
  cvFoldSurvival: 0.6,
  minTrades: 150,
} as const;

const check = (
  key: string,
  label: string,
  value: number | null | undefined,
  threshold: number,
  ok: (v: number) => boolean,
  detail: (v: number | null) => string,
): GateCheck => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { key, label, status: "not-measured", value: null, threshold, detail: detail(null) };
  }
  return {
    key,
    label,
    status: ok(value) ? "pass" : "fail",
    value,
    threshold,
    detail: detail(value),
  };
};

export interface PromotionVerdict {
  promote: boolean;
  checks: GateCheck[];
  failed: string[];
  /** Checks with no measurement. Never counted as passes. */
  evidenceGaps: string[];
  summary: string;
}

export function evaluatePromotion(e: PromotionEvidence): PromotionVerdict {
  const checks: GateCheck[] = [
    check(
      "randomEntry",
      "Beats matched random entries",
      e.randomEntryPercentile,
      GATE.randomEntryPercentile,
      (v) => v >= GATE.randomEntryPercentile,
      (v) =>
        v === null
          ? "No random-entry benchmark has been run."
          : `Real result sits at the ${v.toFixed(1)}th percentile of matched random entries.`,
    ),
    check(
      "dsr",
      "Deflated Sharpe after trial correction",
      e.deflated?.dsr,
      GATE.dsr,
      (v) => v > GATE.dsr,
      (v) =>
        v === null
          ? "No deflated Sharpe computed."
          : `DSR ${(v * 100).toFixed(1)}% against a hurdle built from ${e.deflated?.trials ?? "?"} logged trials.`,
    ),
    check(
      "tStat",
      "t-statistic above the Harvey/Liu/Zhu hurdle",
      e.deflated?.tStat,
      GATE.tStat,
      (v) => v > GATE.tStat,
      (v) => (v === null ? "No t-statistic computed." : `t = ${v.toFixed(2)}.`),
    ),
    check(
      "pbo",
      "Probability of backtest overfitting",
      e.pbo?.pbo,
      GATE.pbo,
      (v) => v < GATE.pbo,
      (v) =>
        v === null
          ? "No PBO computed."
          : `${(v * 100).toFixed(1)}% of balanced splits put the in-sample winner below the out-of-sample median.`,
    ),
    check(
      "oosNetExpectancy",
      "Positive expectancy out of sample, net of costs",
      e.oosNetExpectancy,
      GATE.oosNetExpectancy,
      (v) => v > GATE.oosNetExpectancy,
      (v) =>
        v === null
          ? "No out-of-sample expectancy measured."
          : `$${v.toFixed(2)} per trade after modelled commission and slippage.`,
    ),
    check(
      "cvFoldSurvival",
      "Survives purged cross-validation folds",
      e.cvFoldSurvival,
      GATE.cvFoldSurvival,
      (v) => v >= GATE.cvFoldSurvival,
      (v) =>
        v === null
          ? "No purged cross-validation run."
          : `Positive in ${(v * 100).toFixed(0)}% of purged, embargoed folds.`,
    ),
    check(
      "trades",
      "Enough closed trades to judge",
      e.trades,
      GATE.minTrades,
      (v) => v >= GATE.minTrades,
      (v) => (v === null ? "Trade count unknown." : `${v.toLocaleString()} closed trades.`),
    ),
  ];

  const failed = checks.filter((c) => c.status === "fail").map((c) => c.key);
  const evidenceGaps = checks.filter((c) => c.status === "not-measured").map((c) => c.key);
  const promote = failed.length === 0 && evidenceGaps.length === 0;

  let summary: string;
  if (promote) {
    summary = "Clears every gate. Eligible for paper.";
  } else if (failed.length && evidenceGaps.length) {
    summary =
      `Blocked: ${failed.length} check(s) failed and ${evidenceGaps.length} were never measured. ` +
      "An unmeasured check is not a pass.";
  } else if (failed.length) {
    summary = `Blocked: ${failed.join(", ")}.`;
  } else {
    summary =
      `Not eligible yet: ${evidenceGaps.join(", ")} not measured. ` +
      "The gate reports this as missing evidence, not as a failure.";
  }
  return { promote, checks, failed, evidenceGaps, summary };
}

/* The three live streams, stated as evidence so the gate can be shown refusing
   them. This is the honest use of a gate: run it against what you already have
   and check it says no. A gate first exercised on a candidate you want to
   promote has never been tested in the direction that matters. */
export const REFUTED_STREAM_EVIDENCE: Record<string, PromotionEvidence> = {
  A: { randomEntryPercentile: 0.0, oosNetExpectancy: -48.36, trades: 1180 },
  "B:MES": { randomEntryPercentile: 35.2, oosNetExpectancy: -25.75, trades: 2641 },
  "B:MNQ": { randomEntryPercentile: 65.2, oosNetExpectancy: -10.54, trades: 2731 },
};
