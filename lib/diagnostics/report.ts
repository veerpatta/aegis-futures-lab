/* The shape of the Phase 1 artefact, shared by the script that writes it
   (scripts/diag/random-entry.ts) and the view that reads it
   (components/diagnostics/DiagnosticsClient.tsx). One definition so the two
   cannot drift — a dashboard reading a stale key would render "—" and look
   like a measurement rather than a bug. */

import type { SamplingMode } from "./randomEntry";
import type { Verdict } from "./randomEntryRun";

export interface GrossNetRow {
  stream: string;
  trades: number;
  grossTotal: number;
  netTotal: number;
  grossPerTrade: number | null;
  netPerTrade: number | null;
  meanQty: number;
  minQty: number;
  maxQty: number;
  frictionPerContract: number;
  modelledCost: number;
  /** gross − net, measured from the two books. */
  measuredDrag: number;
  /** measuredDrag / |netTotal|. Above 1 means the gross book was profitable. */
  costShareOfLoss: number;
  sameSignals: number;
}

export interface ExcursionRow {
  stream: string;
  n: number;
  reliable: boolean;
  avgMaeR: number | null;
  avgMfeR: number | null;
  avgMaeAtr: number | null;
  avgMfeAtr: number | null;
  edgeRatio: number | null;
  edgeRatioWinners: number | null;
  edgeRatioLosers: number | null;
  avgMinutesToMae: number | null;
  avgMinutesToMfe: number | null;
  avgExitEfficiency: number | null;
}

export interface RandomEntryCell {
  cell: string;
  stream: string;
  symbol: string;
  year: string;
  /** Per cell, because tier A's whole-archive null is far more expensive. */
  iterations: number;
  realTrades: number;
  realNet: number;
  realAvgR: number;
  realPf: number;
  percentileAvgR: number;
  percentileNet: number;
  pValueAvgR: number;
  medianNullAvgR: number;
  p95NullAvgR: number;
  medianNullNet: number;
  realisedNRatio: number;
  minuteDeviation: number;
  verdict: Verdict;
  /** Set when the null involves an approximation that must be stated. */
  caveat?: string;
  /* True when this cell was run with costs switched OFF on BOTH sides — the
     real book and the null. Diagnostic only, never a performance claim: it
     isolates whether the ENTRY carries information, separately from whether
     the resulting edge is large enough to survive friction. Necessary because
     when cost dominates both sides, a costed percentile reads
     "indistinguishable" for reasons that have nothing to do with entries. */
  grossOnly?: boolean;
}

export interface CorrelationRow {
  pair: string;
  /* Set when the pair could NOT be measured. The whole row is then a
     placeholder, and every numeric field below is 0.

     It exists because the alternative is worse: the correlation block used to
     be wrapped in `if (mes && mnq)`, so a missing symbol removed the entire
     effective-N section from the report with no message. That deflation is
     load-bearing for every significance claim in this repo — silently dropping
     it inflates them all. An explicit row says "not measured" out loud. */
  unavailable?: string;
  pairs: number;
  overall: number;
  medianRolling: number;
  minRolling: number;
  maxRolling: number;
  shareAbove80: number;
  nominalTrades: number;
  effectiveTrades: number;
}

/* ── Phase 4 ─────────────────────────────────────────────────────────────*/

export interface OvernightRow {
  symbol: string;
  sessions: number;
  excludedSeams: number;
  overnightBps: { mean: number; lo: number; hi: number };
  intradayBps: { mean: number; lo: number; hi: number };
  overnightTotalPct: number;
  intradayTotalPct: number;
  overnightShare: number;
  overnightWinRate: number;
  intradayWinRate: number;
}

export interface HypothesisTrial {
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
  gate: {
    promote: boolean;
    failed: string[];
    evidenceGaps: string[];
    summary: string;
    checks: { key: string; label: string; status: string; value: number | null; threshold: number; detail: string }[];
  };
}

export interface NotTested {
  candidate: string;
  reason: string;
}

export interface Phase4Report {
  generatedFrom: string;
  measuredAt: string;
  barSource: string;
  iterations: number;
  priorTrials: number;
  totalTrials: number;
  trialSharpeDispersion: number;
  overnight: OvernightRow[];
  trials: HypothesisTrial[];
  deflatedSharpe: {
    sharpe: number;
    dsr: number;
    tStat: number;
    trials: number;
    expectedMaxSharpe: number;
    significant: boolean;
  } | null;
  pbo: { pbo: number; combinations: number; strategies: number; meanIsPerformance: number; meanOosPerformance: number } | null;
  cvSummary: { folds: number; meanTrain: number; meanTest: number; totalPurged: number; totalEmbargoed: number; discardedShare: number };
  notTested: NotTested[];
}

export interface Phase1Report {
  generatedFrom: string;
  measuredAt: string;
  barSource: string;
  iterations: number;
  mode: SamplingMode;
  costModel: string;
  windowFrom: string;
  windowTo: string;
  grossNet: GrossNetRow[];
  excursion: ExcursionRow[];
  randomEntry: RandomEntryCell[];
  correlation: CorrelationRow[];
}

/* The headline: how many cells cleared the brief's bar.
   Stated as a function so the page and the script cannot disagree about what
   "beat random" means. */
export function beatCount(cells: RandomEntryCell[]): number {
  return cells.filter((c) => c.verdict === "beats-random").length;
}

export function overallVerdict(cells: RandomEntryCell[]): {
  tone: "good" | "bad" | "warn";
  headline: string;
  detail: string;
} {
  if (!cells.length) {
    return { tone: "warn", headline: "Not measured", detail: "No cells have been run yet." };
  }
  const beats = beatCount(cells);
  const worse = cells.filter((c) => c.verdict === "worse-than-random").length;
  if (beats === cells.length) {
    return {
      tone: "good",
      headline: "Beats random entries",
      detail: `All ${cells.length} symbol-years sit at or above the 95th percentile of matched random entries.`,
    };
  }
  if (beats > 0) {
    return {
      tone: "warn",
      headline: "Mixed",
      detail: `${beats} of ${cells.length} symbol-years clear the 95th percentile. A minority of cells clearing the bar is what selection looks like, not what edge looks like.`,
    };
  }
  return {
    tone: "bad",
    headline: "No better than random",
    detail:
      `0 of ${cells.length} symbol-years clear the 95th percentile of matched random entries` +
      (worse ? `, and ${worse} sit below the 5th — actively anti-predictive.` : ".") +
      " The entry signal contributes nothing, and no amount of parameter tuning will change that.",
  };
}
