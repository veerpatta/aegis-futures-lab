/* Phase 4 — test better-supported hypotheses with the machinery that refuted
   the incumbents.
   ─────────────────────────────────────────────────────────────────────────
   The brief's rule after a dead signal is: do not optimise it, build the
   infrastructure to test better-supported ideas. That infrastructure already
   exists (Phase 1 diagnostics, Phase 3 gates); this script points it at the
   candidates.

   EVERY PARAMETER VALUE TRIED IS A TRIAL. Not every hypothesis — every value.
   Three relative-volume thresholds is three trials, and the deflated Sharpe
   hurdle rises with the count. The trial count is READ FROM research_trials,
   not passed as a constant, because a hurdle computed from a number the author
   chose is not a hurdle. The script prints the registration SQL for every
   trial it is about to run so the registry is written BEFORE the result is
   seen, which is the only ordering that makes a prediction mean anything.

   WHAT IS NOT TESTED HERE, and why — recorded so a hypothesis board that shows
   two candidates is not mistaken for a survey of five:

     · Time-series momentum (Moskowitz, Ooi & Pedersen). Multi-week to
       multi-month holding. This engine flattens every session at 15:25
       (SESSION_EXIT_MINUTE) and has no multi-day holding path at all. Testing
       it is an engine change, not a strategy addition.
     · Order-flow imbalance (Cont, Kukanov & Stoikov). Real, but decays in
       seconds. The archive is 5-minute bars; the effect is over before the
       first bar closes. Not testable on this data at any parameter setting.

   Read-only. Run with:
     $env:BAR_SOURCE="databento"; npx tsx scripts/diag/phase4.ts
     npx tsx scripts/diag/phase4.ts --iterations 200 --sql */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import { runGrossNet } from "@/lib/backtest/grossNet";
import { alignArchiveSlice } from "@/lib/data/window";
import { fetchArchiveBars } from "@/lib/data/archive";
import { parseBarSource } from "@/lib/data/source";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { LEGACY_MODEL } from "@/lib/costs";
import { describeOvernight, overnightSplit } from "@/lib/diagnostics/overnight";
import {
  candidatePool,
  profileFrom,
  type Geometry,
  type SessionWindow,
} from "@/lib/diagnostics/randomEntry";
import { runNullDistribution, statsOf, verdictFor } from "@/lib/diagnostics/randomEntryRun";
import { deflatedSharpe, trialSharpeDispersion } from "@/lib/validation/deflatedSharpe";
import { probabilityOfBacktestOverfitting } from "@/lib/validation/pbo";
import { combinatorialPurgedCv, summariseFolds } from "@/lib/validation/purgedCv";
import { evaluatePromotion, type PromotionEvidence } from "@/lib/validation/promotionGate";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL } from "@/scripts/engine/tiers";
import { defaultParams, type ParamValues } from "@/lib/strategies/types";
import { strategyById } from "@/lib/strategies/registry";
import { nyMeta } from "@/lib/time/ny";

const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);
const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ITERATIONS = Number(arg("--iterations", "500"));
const OUT = arg("--out", "docs/research/phase4-hypotheses.json");
const PRINT_SQL = process.argv.includes("--sql");
const SQL_ONLY = process.argv.includes("--sql-only");
const ONLY_TRIAL = arg("--trial", "");
const ONLY_SYMBOL = arg("--symbol", "");
const CELL_MODE = Boolean(ONLY_TRIAL || ONLY_SYMBOL);

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);

const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const RTH: SessionWindow = { fromMin: 570, toMin: SESSION_EXIT_MINUTE };

/* The grid, declared up front rather than discovered while looking at
   results. Each row is one trial and is registered as one. */
interface TrialSpec {
  key: string;
  strategyId: string;
  hypothesis: string;
  prediction: string;
  params: ParamValues;
}

const DECISION_RULE =
  "Eligible for paper only if every promotion check passes: matched-random percentile >=95, " +
  "deflated Sharpe >0.95 after the full logged-trial correction, t-statistic >3, PBO <0.5, " +
  "positive net expectancy across purged out-of-sample folds, CV fold survival >=0.6, and " +
  "at least 150 closed trades. Any failure or missing measurement blocks promotion.";

const configHash = (spec: TrialSpec) => `phase4-${spec.key}-${BAR_SOURCE}`;

function grid(): TrialSpec[] {
  const orbBase = defaultParams(strategyById("orb-relvol"));
  const tomBase = defaultParams(strategyById("turn-of-month"));
  const out: TrialSpec[] = [];

  for (const relVolMin of [1.2, 1.5, 2.0]) {
    out.push({
      key: `orb-relvol-${relVolMin}`,
      strategyId: "orb-relvol",
      hypothesis:
        "On index futures, opening-range breakouts taken only on days whose volume is running " +
        `at least ${relVolMin}x the median for the same minute of session carry directional edge ` +
        "(Zarattini, Barbon & Aziz 2024, equities).",
      prediction:
        "Will NOT clear the 95th percentile of matched random entries. The published effect is " +
        "single-stock, where 'in play' detects idiosyncratic news; an index future aggregates " +
        "hundreds of names and has no equivalent catalyst. Futures volume is also contaminated " +
        "at the contract roll.",
      params: { ...orbBase, relVolMin },
    });
  }
  for (const [lastDays, firstDays] of [[1, 3], [1, 1], [4, 4]] as const) {
    out.push({
      key: `turn-of-month-${lastDays}-${firstDays}`,
      strategyId: "turn-of-month",
      hypothesis:
        `The intraday component of the turn-of-month effect (last ${lastDays}, first ${firstDays} ` +
        "sessions) is capturable by a long that is flat by the close (Carchano & Pardo, index futures).",
      prediction:
        "Uncertain, leaning negative. This is the strongest-sourced candidate — it survived a " +
        "188-anomaly screen on this asset class — but the published effect spans the overnight " +
        "session and this engine is flat every night. If the drift is overnight (see the " +
        "overnight decomposition in the same run), the intraday leg should find nothing EVEN IF " +
        "the effect is entirely real.",
      params: { ...tomBase, lastDays, firstDays },
    });
  }
  return out;
}

async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  return alignArchiveSlice(await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE }));
}

function registrationSql(specs: TrialSpec[]): string {
  const esc = (text: string) => text.replace(/'/g, "''");
  return specs
    .map(
      (spec) =>
        `insert into public.research_trials (trial_key, hypothesis, prediction, decision_rule, config_hash, params, dataset, status)\n` +
        `values ('${spec.key}', '${esc(spec.hypothesis)}', '${esc(spec.prediction)}',\n` +
        `  '${esc(DECISION_RULE)}',\n` +
        `  '${configHash(spec)}', '${esc(JSON.stringify(spec.params))}'::jsonb,\n` +
        `  '{"source":"${BAR_SOURCE}","symbols":["MES","MNQ"]}'::jsonb, 'registered')\n` +
        `on conflict (config_hash) do nothing;`,
    )
    .join("\n");
}

/** Verify preregistration before loading a single bar or computing a result. */
async function verifyTrialRegistry(specs: TrialSpec[]): Promise<number> {
  const [{ data, error }, counted] = await Promise.all([
    supabase
      .from("research_trials")
      .select("trial_key, config_hash, status, outcome")
      .in("config_hash", specs.map(configHash)),
    supabase.from("research_trials").select("*", { count: "exact", head: true }),
  ]);
  if (error || counted.error) {
    throw new Error(
      `Cannot read the trial registry, so DSR cannot be honest: ${(error ?? counted.error)?.message}`,
    );
  }
  const registered = new Set((data ?? []).map((row) => String(row.config_hash)));
  const missing = specs.filter((spec) => !registered.has(configHash(spec)));
  if (missing.length) {
    throw new Error(
      `${missing.length} Phase 4 trial(s) are not preregistered. Run with --sql-only, ` +
        "write those rows, then start the benchmark. Results are intentionally blocked until then.",
    );
  }
  const completed = (data ?? []).filter((row) => row.outcome !== null);
  if (completed.length) {
    throw new Error(
      String(completed.length) +
        " Phase 4 trial(s) already have a write-once outcome. Re-running them " +
        "requires new config hashes and new trial registrations.",
    );
  }
  return counted.count ?? 0;
}

const requestFor = (spec: TrialSpec, symbol: FeedSymbol, bars: Bar[]): RunRequest => ({
  strategyId: spec.strategyId,
  params: spec.params,
  series: { [symbol]: bars },
  execution: { ...EXECUTION, fillModel: "nextOpen" },
  locks: null,
  startingCapital: STARTING_CAPITAL,
  sessionExitMinute: SESSION_EXIT_MINUTE,
  pointValues: POINT_VALUES,
});

const num = (v: number | null | undefined, dp = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp);

async function main() {
  console.log(`\nPhase 4 hypotheses — source=${BAR_SOURCE}, iterations=${ITERATIONS}\n`);

  const allSpecs = grid();
  const specs = ONLY_TRIAL ? allSpecs.filter((spec) => spec.key === ONLY_TRIAL) : allSpecs;
  const symbols = ONLY_SYMBOL
    ? SYMBOLS.filter((symbol) => symbol === ONLY_SYMBOL)
    : SYMBOLS;
  if (CELL_MODE && (!ONLY_TRIAL || !ONLY_SYMBOL || specs.length !== 1 || symbols.length !== 1)) {
    throw new Error(
      "Cell mode requires one valid --trial and one valid --symbol (MES or MNQ).",
    );
  }
  if (PRINT_SQL || SQL_ONLY) {
    console.log("\n-- Register these BEFORE running the benchmark.\n");
    console.log(registrationSql(specs));
  }
  if (SQL_ONLY) return;

  const totalTrials = await verifyTrialRegistry(specs);
  console.log(
    `  verified ${specs.length} preregistered configurations; ${totalTrials} total logged trials`,
  );

  const bySymbol = new Map<FeedSymbol, Bar[]>();
  for (const s of symbols) {
    bySymbol.set(s, await archiveBars(s));
    console.log(`  loaded ${s}: ${bySymbol.get(s)!.length.toLocaleString()} bars`);
  }

  /* ── The arena, before any strategy ──
     Tests a claim about the instrument rather than about a signal: if the
     drift is overnight, a flat-by-close system cannot reach it, and "no entry
     edge" was the wrong diagnosis all along. */
  console.log("\n── Overnight vs intraday drift ──");
  const overnight = symbols.map((s) => {
    const split = overnightSplit(bySymbol.get(s)!);
    console.log(`  ${describeOvernight(split, s)}`);
    return { symbol: s, ...split };
  });

  console.log(`\n── ${specs.length} preregistered trials to run ──`);

  const rows: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const perTrialSharpes: number[] = [];
  const measurements: {
    rMultiples: number[];
    pnl: number[];
    intervals: { t0: number; t1: number }[];
    dailyR: Map<string, number>;
  }[] = [];

  for (const spec of specs) {
    for (const symbol of symbols) {
      const bars = bySymbol.get(symbol)!;
      const gn = await runGrossNet(requestFor(spec, symbol, bars), executeRun, LEGACY_MODEL);
      const trades = gn.net.trades;
      const s = statsOf(trades);
      const rMultiples = trades.map((t) => t.rMultiple);
      perTrialSharpes.push(
        rMultiples.length > 1 ? statsOf(trades).avgR / (Math.max(1e-9, stdev(rMultiples))) : 0,
      );

      let percentile: number | null = null;
      let realisedNRatio: number | null = null;
      if (trades.length >= 30) {
        const geometry: Geometry = { kind: "atr", atrLen: 14, atrMult: 1.5, targetR: 2 };
        const nullRes = runNullDistribution(
          {
            cell: `${spec.key}|${symbol}`,
            series: { [symbol]: bars },
            execution: { ...EXECUTION, fillModel: "nextOpen" },
            locks: null,
            startingCapital: STARTING_CAPITAL,
            sessionExitMinute: SESSION_EXIT_MINUTE,
            pointValues: POINT_VALUES,
            sessionWindow: RTH,
            profile: profileFrom(trades),
            geometry,
            mode: "matchDayCounts",
            iterations: ITERATIONS,
          },
          trades,
          candidatePool({ [symbol]: bars }, RTH),
        );
        percentile = nullRes.percentileAvgR;
        realisedNRatio = nullRes.realisedNRatio;
        void verdictFor(nullRes);
      }

      const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
      const dailyR = new Map<string, number>();
      for (const trade of ordered) {
        const day = nyMeta(trade.entryTime).dateKey;
        dailyR.set(day, (dailyR.get(day) ?? 0) + trade.rMultiple);
      }
      measurements.push({
        rMultiples: ordered.map((trade) => trade.rMultiple),
        pnl: ordered.map((trade) => trade.pnl),
        intervals: ordered.map((trade) => ({ t0: trade.entryTime, t1: trade.exitTime })),
        dailyR,
      });

      rows.push({
        trial: spec.key,
        symbol,
        trades: s.n,
        gross: Math.round(gn.grossNetTotal),
        net: Math.round(gn.netNetTotal),
        "net/trade": num(trades.length ? s.net / trades.length : null, 2),
        avgR: num(s.avgR),
        PF: num(s.pf, 2),
        percentile: percentile === null ? "n/a" : percentile.toFixed(1),
        "realised N": realisedNRatio === null ? "—" : `${(realisedNRatio * 100).toFixed(0)}%`,
      });
      results.push({
        trial: spec.key,
        strategyId: spec.strategyId,
        symbol,
        params: spec.params,
        hypothesis: spec.hypothesis,
        prediction: spec.prediction,
        trades: s.n,
        grossTotal: Math.round(gn.grossNetTotal),
        netTotal: Math.round(gn.netNetTotal),
        netPerTrade: trades.length ? s.net / trades.length : null,
        avgR: s.avgR,
        pf: s.pf,
        randomEntryPercentile: percentile,
        realisedNRatio,
      });
      console.log(
        `  ${spec.key.padEnd(24)} ${symbol}  n=${String(s.n).padStart(4)}  ` +
          `net ${String(Math.round(s.net)).padStart(8)}  avgR ${num(s.avgR)}  ` +
          `pct ${percentile === null ? " n/a" : percentile.toFixed(1).padStart(5)}`,
      );
    }
  }

  /* GitHub's standard runner cannot finish all twelve 500-draw cells in one
     two-hour job. Cell mode changes scheduling only: each matrix worker writes
     the raw observations needed by the single strict aggregator. The random
     seeds, execution engine and promotion rules are identical to serial mode. */
  if (CELL_MODE) {
    const payload = {
      kind: "phase4-cell",
      generatedFrom: "scripts/diag/phase4.ts",
      measuredAt: new Date().toISOString(),
      barSource: BAR_SOURCE,
      iterations: ITERATIONS,
      candidateTrials: allSpecs.length,
      totalTrials,
      overnight,
      result: results[0],
      measurement: {
        rMultiples: measurements[0].rMultiples,
        pnl: measurements[0].pnl,
        intervals: measurements[0].intervals,
        dailyR: Object.fromEntries(measurements[0].dailyR),
      },
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(payload));
    console.log(`\nWrote cell evidence ${OUT}`);
    return;
  }

  /* Trial-count-aware significance over every preregistered configuration. */
  const dispersion = trialSharpeDispersion(perTrialSharpes.filter(Number.isFinite));

  // PBO needs identical observations. Align on the shared trading-day
  // calendar, not the first N trades (which occur on different dates).
  const days = [...new Set(measurements.flatMap((m) => [...m.dailyR.keys()]))].sort();
  const aligned = measurements.map((m) => days.map((day) => m.dailyR.get(day) ?? 0));
  const pbo =
    aligned.length >= 2 && days.length >= 64
      ? probabilityOfBacktestOverfitting(aligned, { splits: 8 })
      : null;

  results.forEach((result, index) => {
    const measured = measurements[index];
    const deflated =
      measured.rMultiples.length > 2
        ? deflatedSharpe(measured.rMultiples, totalTrials, dispersion)
        : null;
    const folds = combinatorialPurgedCv(measured.intervals, 6, 2);
    const foldExpectancy = folds
      .map((fold) =>
        fold.test.length
          ? fold.test.reduce((sum, i) => sum + measured.pnl[i], 0) / fold.test.length
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
      randomEntryPercentile: result.randomEntryPercentile as number | null,
      deflated,
      pbo,
      oosNetExpectancy,
      cvFoldSurvival,
      trades: result.trades as number,
    };
    Object.assign(result, {
      deflatedSharpe: deflated,
      pbo,
      oosNetExpectancy,
      cvFoldSurvival,
      cvSummary: summariseFolds(folds, measured.intervals.length),
      gate: evaluatePromotion(evidence),
    });
  });

  const best = results.reduce(
    (winner, result) =>
      (result.avgR as number) > ((winner?.avgR as number) ?? -Infinity) ? result : winner,
    results[0],
  );
  const bestDsr = best.deflatedSharpe as ReturnType<typeof deflatedSharpe> | null;

  console.log("\n── Trials ──");
  console.table(rows);
  console.log(
    `\nTrial count for the DSR hurdle: ${totalTrials} total preregistered trials. ` +
      `Trial Sharpe dispersion ${num(dispersion)}.`,
  );
  if (bestDsr) console.log(`Best candidate: DSR ${num(bestDsr.dsr)}, t=${num(bestDsr.tStat, 2)}, significant=${bestDsr.significant}`);
  if (pbo) console.log(`PBO across ${aligned.length} configurations: ${(pbo.pbo * 100).toFixed(1)}%`);

  const promoted = results.filter((r) => (r.gate as { promote: boolean }).promote);
  console.log(`\nVERDICT: ${promoted.length} of ${results.length} candidate runs clear the promotion gate.`);

  const payload = {
    generatedFrom: "scripts/diag/phase4.ts",
    measuredAt: new Date().toISOString(),
    barSource: BAR_SOURCE,
    iterations: ITERATIONS,
    priorTrials: Math.max(0, totalTrials - specs.length),
    candidateTrials: specs.length,
    totalTrials,
    trialSharpeDispersion: dispersion,
    overnight,
    trials: results,
    bestTrial: best.trial,
    deflatedSharpe: bestDsr,
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
  console.log(`\nWrote ${OUT}`);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, v) => a + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
