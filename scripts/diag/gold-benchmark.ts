/* The random-entry benchmark for the gold/silver candidate.
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE SCRIPT FROM random-entry.ts
 *
 * random-entry.ts iterates tierStreams() — the LIVE streams. Gold is not one,
 * and adding it there in order to measure it would be exactly backwards:
 * CLAUDE.md says new ideas go through /diagnostics and the promotion gate,
 * never straight to a tier. A candidate has to be measurable BEFORE it is
 * promoted or that rule cannot be obeyed. So this runs the same machinery
 * (runGrossNet, runNullDistribution, verdictFor) against a strategy the live
 * config has never heard of, and writes evidence rather than changing config.
 *
 * THE INTERPRETATION IS FIXED BEFORE THE RUN, in verdictFor(): the real book
 * must sit at or above the 95th percentile of matched random entries on avg R.
 * Anything else means the entries carry no information, and per the Phase 1
 * brief that is a refutation rather than an invitation to tune.
 *
 * TWO METHODOLOGICAL POINTS, both load-bearing:
 *
 *   1. THE NULL POOL IS GOLD ONLY. candidatePool() walks every symbol in the
 *      series it is handed, and this strategy is handed two. Left alone it
 *      would draw random entries on SILVER — a market the real book never
 *      trades and specs.ts forbids sizing — and then call that a benchmark.
 *      The pool is therefore built from gold alone and passed in explicitly.
 *
 *   2. THERE IS NO SESSION WINDOW. Tier B's null borrows the strategy's own
 *      rth/day window so the null cannot trade hours the strategy could not.
 *      Gold has no minute-of-day window: it gates on the Globex session
 *      (asia/london/ny vs closed), which is not expressible as a minute range.
 *      The pool is left unbounded and the minute-distribution diagnostics
 *      (minuteDeviation / minuteMisses) are REPORTED rather than assumed — if
 *      they are large the null drifted, and the percentile is weaker evidence.
 *
 * Read-only: changes no parameter, promotes nothing, writes no table.
 * Run: $env:BAR_SOURCE="databento"; npx tsx scripts/diag/gold-benchmark.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import { runGrossNet } from "@/lib/backtest/grossNet";
import { alignArchiveSlice } from "@/lib/data/window";
import { fetchArchiveBars, assertArchivePresent } from "@/lib/data/archive";
import { parseBarSource } from "@/lib/data/source";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { nyMeta } from "@/lib/time/ny";
import { LEGACY_MODEL } from "@/lib/costs";
import { candidatePool, bootstrapGeometry, profileFrom } from "@/lib/diagnostics/randomEntry";
import { describeVerdict, runNullDistribution, verdictFor } from "@/lib/diagnostics/randomEntryRun";
import { goldSilverZone, GOLD, SILVER } from "@/lib/strategies/gold-silver-zone";
import { defaultParams } from "@/lib/strategies/types";
import { tradableFeedsFor } from "@/lib/strategies/registry";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL } from "@/scripts/engine/tiers";

const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const ITERATIONS = Number(arg("--iterations", "500"));
const OUT = arg("--out", "docs/research/gold-random-entry.json");

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  const raw = await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE });
  return alignArchiveSlice(
    assertArchivePresent(raw, { symbol, source: BAR_SOURCE, minBars: 100_000 })
  );
}

const params = defaultParams(goldSilverZone);

function requestFor(series: Record<string, Bar[]>): RunRequest {
  return {
    strategyId: goldSilverZone.id,
    params,
    series,
    execution: {
      ...EXECUTION,
      /* The guard this strategy was built to need: silver is confirmation, so
         a signal on it is a bug rather than a trade. */
      tradableSymbols: tradableFeedsFor(goldSilverZone),
    },
    locks: null,
    startingCapital: STARTING_CAPITAL,
    sessionExitMinute: SESSION_EXIT_MINUTE,
    pointValues: POINT_VALUES,
  };
}

const yearOf = (t: number) => nyMeta(t).dateKey.slice(0, 4);

function sliceByYear(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const y = yearOf(b.time);
    if (!out.has(y)) out.set(y, []);
    out.get(y)!.push(b);
  }
  return out;
}

const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

async function main() {
  console.log(
    "\nGold/silver candidate — random-entry benchmark\n" +
      `  source=${BAR_SOURCE}  iterations=${ITERATIONS}  params=defaults\n`
  );

  const gold = await archiveBars(GOLD as FeedSymbol);
  const silver = await archiveBars(SILVER as FeedSymbol);
  console.log(`  loaded ${GOLD}: ${gold.length.toLocaleString()} bars`);
  console.log(`  loaded ${SILVER}: ${silver.length.toLocaleString()} bars (confirmation only)\n`);

  const rows: Record<string, unknown>[] = [];

  const cells: { label: string; series: Record<string, Bar[]> }[] = [
    { label: "MGC:all", series: { [GOLD]: gold, [SILVER]: silver } },
  ];
  const goldYears = sliceByYear(gold);
  const silverYears = sliceByYear(silver);
  for (const y of [...goldYears.keys()].sort()) {
    const gy = goldYears.get(y)!;
    if (gy.length < 5_000) continue;
    cells.push({ label: `MGC:${y}`, series: { [GOLD]: gy, [SILVER]: silverYears.get(y) ?? [] } });
  }

  for (const cell of cells) {
    const gn = await runGrossNet(requestFor(cell.series), executeRun, LEGACY_MODEL);
    const trades = gn.net.trades;
    if (trades.length === 0) {
      console.log(`  ${cell.label.padEnd(12)} no trades — nothing to benchmark`);
      rows.push({ cell: cell.label, n: 0, verdict: "insufficient-sample" });
      continue;
    }

    /* Gold only. See the header: an unrestricted pool would draw random
       entries on silver and call the comparison a benchmark. */
    const pool = candidatePool({ [GOLD]: cell.series[GOLD] }, null);

    const res = runNullDistribution(
      {
        cell: cell.label,
        series: cell.series,
        execution: requestFor(cell.series).execution,
        locks: null,
        startingCapital: STARTING_CAPITAL,
        sessionExitMinute: SESSION_EXIT_MINUTE,
        pointValues: POINT_VALUES,
        sessionWindow: null,
        profile: profileFrom(trades),
        geometry: bootstrapGeometry(trades),
        mode: "matchDayCounts",
        iterations: ITERATIONS,
      },
      trades,
      pool
    );

    console.log(
      `  ${cell.label.padEnd(12)} n=${String(res.real.n).padStart(4)}  ` +
        `net=${num(res.real.net, 0).padStart(9)}  avgR=${num(res.real.avgR, 3).padStart(7)}  ` +
        `pct(avgR)=${num(res.percentileAvgR, 1).padStart(5)}  ${verdictFor(res)}`
    );

    rows.push({
      cell: cell.label,
      n: res.real.n,
      gross: gn.grossNetTotal,
      net: res.real.net,
      avgR: res.real.avgR,
      percentileAvgR: res.percentileAvgR,
      percentileNet: res.percentileNet,
      pValueAvgR: res.pValueAvgR,
      medianNullNet: res.medianNullNet,
      verdict: verdictFor(res),
      realisedNRatio: res.realisedNRatio,
      minuteDeviation: res.minuteDeviation,
      minuteMisses: res.minuteMisses,
      describe: describeVerdict(res),
    });
  }

  const judged = rows.filter((r) => r.verdict !== "insufficient-sample");
  const beat = judged.filter((r) => r.verdict === "beats-random");
  console.log(`\n  ${beat.length} of ${judged.length} judged cells beat matched random entries.\n`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        strategyId: goldSilverZone.id,
        source: BAR_SOURCE,
        iterations: ITERATIONS,
        params,
        poolRestrictedTo: GOLD,
        sessionWindow: null,
        rows,
      },
      null,
      2
    )
  );
  console.log(`  wrote ${OUT}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
