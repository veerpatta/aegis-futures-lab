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
   money, and a person starts them.

   Also here, as pure functions: which methods a run picks (planBenchmarks —
   resuming a trial that was preregistered but never measured) and how many
   (parseBenchmarkCount). */

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

/* ── Which methods a run measures ─────────────────────────────────────────
   One preregistered trial per method per configuration (the config hash
   includes the research-code hash, and research_trials.config_hash is
   UNIQUE). The trial row is written BEFORE measuring, so a run that dies
   halfway leaves a row with no outcome.

   The first version skipped ANY method whose config hash had a row. Its first
   run (2026-10-04) preregistered ema-cross, lost its database connection
   loading MNQ, and left ema-cross unmeasurable on this code version forever.
   A registered-but-unmeasured trial is an open obligation, not a result:

     resumable   status registered|running and no outcome — measure it now,
                 reusing the SAME row (its hypothesis, prediction and decision
                 rule are write-once; only status, outcome and decided_at move)
     done        an outcome is recorded, or the trial was abandoned — skip

   Resumable trials go first: each already counts toward the multiple-testing
   total, so finishing it costs nothing extra, while a fresh pick adds a trial. */

export interface TrialState {
  configHash: string;
  trialKey: string;
  status: string;
  hasOutcome: boolean;
}

export interface BenchmarkPick<T> {
  strategy: T;
  configHash: string;
  /** The existing outcome-less trial to finish, or null to preregister a new one. */
  resume: TrialState | null;
}

export function isResumableTrial(t: TrialState): boolean {
  return !t.hasOutcome && (t.status === "registered" || t.status === "running");
}

/** Up to `count` methods to measure, resumable trials first, then never-registered
    methods, each in registry order. Methods with a recorded outcome or an
    abandoned trial are never picked again on the same configuration. */
export function planBenchmarks<T>(
  eligible: readonly T[],
  hashOf: (s: T) => string,
  trials: readonly TrialState[],
  count: number
): BenchmarkPick<T>[] {
  const byHash = new Map(trials.map((t) => [t.configHash, t]));
  const resumes: BenchmarkPick<T>[] = [];
  const fresh: BenchmarkPick<T>[] = [];
  for (const strategy of eligible) {
    const configHash = hashOf(strategy);
    const trial = byHash.get(configHash);
    if (!trial) fresh.push({ strategy, configHash, resume: null });
    else if (isResumableTrial(trial)) resumes.push({ strategy, configHash, resume: trial });
  }
  return [...resumes, ...fresh].slice(0, Math.max(0, count));
}

/** A manual run may measure up to four methods; the weekly schedule measures one. */
export const MAX_BENCHMARK_COUNT = 4;

/** `--count` / BENCHMARK_COUNT: blank means 1; anything but a whole number in
    1..MAX_BENCHMARK_COUNT is refused rather than clamped, so a typo cannot
    silently register more trials than the owner asked for. */
export function parseBenchmarkCount(raw: string | undefined | null): number {
  const text = (raw ?? "").trim();
  if (!text) return 1;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BENCHMARK_COUNT)
    throw new Error(`count must be a whole number from 1 to ${MAX_BENCHMARK_COUNT}, got "${raw}"`);
  return n;
}

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
