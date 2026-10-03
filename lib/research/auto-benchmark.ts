/* The preregistered decision rule for the weekly auto-benchmark
   (scripts/diag/auto-benchmark.ts), as a pure function so it can be pinned by
   tests and cannot drift from the text registered in research_trials:

     beats-random       every judged all-years cell (n ≥ 30) is at or above the
                        95th percentile, AND at least half of the judged
                        symbol-years are too;
     no-edge            any judged all-years cell is below the 95th percentile;
     insufficient-sample no all-years cell has 30 trades.

   It is a screen. gate.promote is always false: the promotion gate, a separate
   confirmation and 60 new trades still stand between any result and practice
   money, and a person starts them. */

export type CellVerdict =
  | "beats-random"
  | "worse-than-random"
  | "indistinguishable-from-random"
  | "insufficient-sample";

export interface CellResult {
  cell: string;
  symbol: string;
  allYears: boolean;
  n: number;
  net: number;
  percentile: number | null;
  verdict: CellVerdict;
  describe?: string;
}

export interface AutoBenchmarkOutcome {
  kind: "auto-benchmark";
  strategyId: string;
  verdict: "beats-random" | "no-edge" | "insufficient-sample";
  headline: string;
  nextStep: string;
  judgedYears: number;
  yearsBeating: number;
  gate: { promote: false; note: string };
}

const judged = (c: CellResult) => c.verdict !== "insufficient-sample";

export function autoBenchmarkOutcome(strategyId: string, cells: CellResult[]): AutoBenchmarkOutcome {
  const all = cells.filter((c) => c.allYears && judged(c));
  const years = cells.filter((c) => !c.allYears && judged(c));
  const yearsBeating = years.filter((c) => c.verdict === "beats-random").length;
  const base = {
    kind: "auto-benchmark" as const,
    strategyId,
    judgedYears: years.length,
    yearsBeating,
    gate: { promote: false as const, note: "Screen only. The promotion gate is a separate, human-started step." },
  };

  if (!all.length)
    return {
      ...base,
      verdict: "insufficient-sample",
      headline: `${strategyId}: too few trades to judge — it stays "not tested yet".`,
      nextStep: "No standing change. The method trades too rarely on these markets to measure.",
    };

  const allBeat = all.every((c) => c.verdict === "beats-random");
  if (allBeat && years.length > 0 && yearsBeating * 2 >= years.length)
    return {
      ...base,
      verdict: "beats-random",
      headline: `${strategyId}: beat matched random entries in every market overall and in ${yearsBeating} of ${years.length} market-years.`,
      nextStep:
        "A screen passed — not a promotion. A person may register it for the full promotion gate and a separate confirmation. Standing stays 'not tested yet' until then.",
    };

  return {
    ...base,
    verdict: "no-edge",
    headline: `${strategyId}: did not beat matched random entries (${yearsBeating} of ${years.length} market-years at the 95th percentile).`,
    nextStep:
      "Suggested: move it from 'unmeasured' to 'refuted' in lib/strategies/research-standing.json (a person's commit). Do not tune it.",
  };
}
