/* Phase 1 truth layer, run against the real archive.
   ─────────────────────────────────────────────────────────────────────────
   Produces three things per live stream, over seven years of Databento
   GLBX.MDP3 bars:

     1. GROSS vs NET, as two separate runs. Costs were never missing from this
        engine — pnl has always been `points*point*qty - cost*qty`. What was
        missing is the counterfactual: what the same rules do with the cost
        switched off. Reported side by side, always.

     2. EXCURSION, including the ATR-normalised edge ratio, which localises the
        failure: losers dying with near-zero MAE is an entry problem, large
        unrealised MFE is an exit problem.

     3. The RANDOM-ENTRY NULL. Trade management, cost model, session filter,
        trade count, direction mix and time-of-day are all held fixed; entry
        timing and direction are randomised. If the real stream does not sit at
        or above the 95th percentile of that null, the entry signal contributes
        nothing and no amount of parameter tuning will help.

   THE INTERPRETATION IS FIXED BEFORE THE RUN, in randomEntryRun.ts's
   verdictFor(). Because these streams lose money gross, the null is likely to
   lose money too — that is a SEPARATE finding about trade management, not a
   verdict on the entries, and the report keeps the two apart.

   Read-only: changes no parameter, writes no table. Run with:
     $env:BAR_SOURCE="databento"; npx tsx scripts/diag/random-entry.ts
     npx tsx scripts/diag/random-entry.ts --iterations 200 --stream B:MES */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Bar, Trade } from "@/lib/types";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import { runGrossNet } from "@/lib/backtest/grossNet";
import { excursionSummary } from "@/lib/backtest/metrics";
import { alignArchiveSlice } from "@/lib/data/window";
import { fetchArchiveBars } from "@/lib/data/archive";
import { parseBarSource } from "@/lib/data/source";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { nyMeta } from "@/lib/time/ny";
import { LEGACY_MODEL, frictionDollarsPerContract } from "@/lib/costs";
import { stableHash } from "@/scripts/engine/learning-audit";
import {
  bootstrapGeometry,
  candidatePool,
  profileFrom,
  type Geometry,
  type SamplingMode,
  type SessionWindow,
} from "@/lib/diagnostics/randomEntry";
import {
  describeEffectiveN,
  effectiveSampleSize,
  summariseCorrelation,
} from "@/lib/diagnostics/correlation";
import type {
  CorrelationRow,
  ExcursionRow,
  GrossNetRow,
  Phase1Report,
  RandomEntryCell,
} from "@/lib/diagnostics/report";
import { describeVerdict, runNullDistribution, statsOf, verdictFor } from "@/lib/diagnostics/randomEntryRun";
import {
  EXECUTION,
  SESSION_EXIT_MINUTE,
  STARTING_CAPITAL,
  tierStreams,
  type TierStream,
} from "@/scripts/engine/tiers";

const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const ITERATIONS = Number(arg("--iterations", "1000"));

/* Tier A runs fewer iterations, and the reason is compute rather than
   convenience — stated here so it cannot look like a result that was tuned
   down until it behaved.
 *
 * The brief asks for >=1,000 iterations per SYMBOL-YEAR. Tier A has no
 * symbol-years: it trades on 287 of 1,838 sessions (tiers.ts:65-67), so one
 * tier-A year is ~65 trades and its null must run over the whole archive
 * instead. That means every iteration re-indexes a 1,000,000-bar union
 * timeline — the engine's per-run setup, not its per-bar walk, dominates, and
 * the cost is ~200x a tier-B symbol-year.
 *
 * 250 draws still resolve the 95th percentile to within a few tenths and put
 * the p-value floor at 1/251 = 0.004, which is far below any threshold this
 * study uses. Tier A is also the weaker evidence regardless (see
 * TIER_A_CAVEAT), so precision there is not the binding constraint on the
 * conclusion. Raise it with --tier-a-iterations if you want to check. */
const TIER_A_ITERATIONS = Number(arg("--tier-a-iterations", "250"));
const MODE = arg("--mode", "matchDayCounts") as SamplingMode;
const ONLY = arg("--stream", "");
const OUT = arg("--out", "docs/research/phase1-random-entry.json");

/* Run the null AND the real book with costs off, on both sides.
 *
 * WHY THIS IS A SEPARATE MODE AND NOT THE DEFAULT: the costed null is the
 * honest performance comparison and must stay the headline. But when friction
 * is 84-101% of the loss it dominates BOTH the real book and the null, so the
 * costed percentile can read "indistinguishable" for a reason that has nothing
 * to do with entry information. Comparing gross against gross isolates the one
 * question the brief actually asks of the entry signal. Diagnostic only —
 * a gross result is never a performance claim, because nobody trades gross. */
const GROSS_ONLY = process.argv.includes("--gross");

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);

async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  return alignArchiveSlice(await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE }));
}

const num = (v: number | null, dp = 2) =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(dp);

const streamKey = (s: TierStream) => (s.tier === "A" ? "A" : `B:${s.symbols.join("+")}`);

/* rsi-reversion's own window, read off lib/strategies/rsi-reversion.ts:76-77.
   The null MUST use the same one: a pool wider than the strategy's window
   would let random entries trade hours the strategy never could. */
function sessionWindowFor(stream: TierStream): SessionWindow | null {
  const session = stream.params.session;
  if (session === "rth") return { fromMin: 570, toMin: 925 };
  if (session === "day") return { fromMin: 120, toMin: 925 };
  // Tier A (zone-v5) has no session param; it is bounded by the flat-by rule.
  return stream.tier === "A" ? { fromMin: 570, toMin: SESSION_EXIT_MINUTE } : null;
}

function requestFor(stream: TierStream, series: Record<string, Bar[]>): RunRequest {
  return {
    strategyId: stream.strategyId,
    params: stream.params,
    series,
    execution: {
      ...EXECUTION,
      fillModel: stream.fillModel,
      maxRisk: stream.maxRisk ?? EXECUTION.maxRisk,
    },
    locks: stream.locks,
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
    (out.get(y) ?? out.set(y, []).get(y)!).push(b);
  }
  return out;
}

/* Tier A's null is not like tier B's, and the difference must travel with the
   number rather than living in a commit message. Two approximations:
   (1) the live stream rests limit orders at a zone's proximal line; a random
       entry has no zone, so its null must fill at the next open;
   (2) the stop is structural (the zone's distal line) and is bootstrapped
       from the real book in ATR units instead of being reproduced. */
const TIER_A_CAVEAT =
  "Approximate: tier A rests limit orders at zone lines, so the null fills at " +
  "next-open instead; and its structural stop is bootstrapped from the real " +
  "book in ATR units. Weaker evidence than tier B, whose stop and target rule " +
  "the null reproduces exactly.";

async function main() {
  console.log(`\nPhase 1 truth layer — source=${BAR_SOURCE}, iterations=${ITERATIONS}, mode=${MODE}\n`);

  const streams = tierStreams().filter((s) => !ONLY || streamKey(s) === ONLY);
  const barsBySymbol = new Map<FeedSymbol, Bar[]>();
  for (const symbol of new Set(streams.flatMap((s) => s.symbols))) {
    barsBySymbol.set(symbol, await archiveBars(symbol));
    console.log(`  loaded ${symbol}: ${barsBySymbol.get(symbol)!.length.toLocaleString()} bars`);
  }

  const grossNetRows: GrossNetRow[] = [];
  const excursionRows: ExcursionRow[] = [];
  const cells: RandomEntryCell[] = [];
  const verdictLines: string[] = [];

  for (const stream of streams) {
    const key = streamKey(stream);
    const series = Object.fromEntries(stream.symbols.map((s) => [s, barsBySymbol.get(s)!]));
    const window = sessionWindowFor(stream);

    /* ── 1. Gross vs net ── */
    const gn = await runGrossNet(requestFor(stream, series), executeRun, LEGACY_MODEL);
    const d = gn.divergence;
    const measuredDrag = gn.grossNetTotal - gn.netNetTotal;
    grossNetRows.push({
      stream: key,
      trades: gn.net.trades.length,
      grossTotal: Math.round(gn.grossNetTotal),
      netTotal: Math.round(gn.netNetTotal),
      grossPerTrade: gn.grossPerTrade,
      netPerTrade: gn.netPerTrade,
      meanQty: d.meanNetQty,
      minQty: d.minNetQty,
      maxQty: d.maxNetQty,
      frictionPerContract: frictionDollarsPerContract(LEGACY_MODEL, stream.symbols[0]),
      modelledCost: Math.round(d.frictionOnNetBook),
      measuredDrag: Math.round(measuredDrag),
      costShareOfLoss: measuredDrag / Math.abs(gn.netNetTotal),
      sameSignals: d.sameKeyCount,
    });

    /* ── 2. Excursion ── */
    // In --gross mode the real book is the cost-free run, so the null it is
    // compared against is measuring the same thing it is.
    const real = GROSS_ONLY ? gn.gross.trades : gn.net.trades;
    const ex = excursionSummary(real);
    excursionRows.push({ stream: key, ...ex });

    /* ── 3. Random-entry null ──
       Tier B is split per symbol-year, as the brief specifies. Tier A is NOT:
       it trades on 287 of 1,838 sessions, so one tier-A year is ~65 trades
       across ~36 sessions — too thin for a per-year null. It gets a single
       whole-archive cell instead, and the report says so. */
    const geometry: Geometry =
      stream.strategyId === "rsi-reversion"
        ? {
            kind: "atr",
            atrLen: 14,
            atrMult: Number(stream.params.atrMult ?? 1.5),
            targetR: Number(stream.params.targetR ?? 1.5),
          }
        : bootstrapGeometry(real);

    if (geometry.kind === "bootstrap" && geometry.draws.length === 0) {
      console.log(`  ${key}: no bootstrap geometry available, skipping null`);
      continue;
    }

    const slices: { year: string; series: Record<string, Bar[]>; trades: Trade[] }[] = [];
    if (stream.tier === "B") {
      const symbol = stream.symbols[0];
      for (const [year, yearBars] of sliceByYear(series[symbol])) {
        if (yearBars.length < 5000) continue; // partial year, not a cell
        slices.push({
          year,
          series: { [symbol]: yearBars },
          trades: real.filter((t) => yearOf(t.entryTime) === year),
        });
      }
    } else {
      slices.push({ year: "all", series, trades: real });
    }

    for (const slice of slices) {
      if (slice.trades.length < 30) {
        console.log(`  ${key} ${slice.year}: only ${slice.trades.length} trades, skipped`);
        continue;
      }
      const cell = `${key}|${slice.year}`;
      const pool = candidatePool(slice.series, window);
      const iterations = stream.tier === "A" ? TIER_A_ITERATIONS : ITERATIONS;
      const started = process.hrtime.bigint();
      process.stdout.write(`  ${cell.padEnd(16)} running ${iterations} iterations…\r`);
      const r = runNullDistribution(
        {
          cell,
          series: slice.series,
          execution: {
            ...EXECUTION,
            fillModel: stream.fillModel,
            maxRisk: stream.maxRisk ?? EXECUTION.maxRisk,
            // Costs off on BOTH sides in --gross mode, or the comparison is
            // rigged: a costed null against a cost-free real book would make
            // any strategy look good.
            ...(GROSS_ONLY ? { cost: 0, slippage: 0 } : {}),
          },
          locks: stream.locks,
          startingCapital: STARTING_CAPITAL,
          sessionExitMinute: SESSION_EXIT_MINUTE,
          pointValues: POINT_VALUES,
          sessionWindow: window,
          profile: profileFrom(slice.trades),
          geometry,
          mode: MODE,
          iterations,
        },
        slice.trades,
        pool,
      );
      const secs = Number(process.hrtime.bigint() - started) / 1e9;
      const s = statsOf(slice.trades);
      cells.push({
        cell,
        stream: key,
        symbol: stream.symbols.join("+"),
        year: slice.year,
        iterations,
        realTrades: s.n,
        realNet: Math.round(s.net),
        realAvgR: s.avgR,
        realPf: s.pf,
        percentileAvgR: r.percentileAvgR,
        percentileNet: r.percentileNet,
        pValueAvgR: r.pValueAvgR,
        medianNullAvgR: r.medianNullAvgR,
        p95NullAvgR: r.p95NullAvgR,
        medianNullNet: Math.round(r.medianNullNet),
        realisedNRatio: r.realisedNRatio,
        minuteDeviation: r.minuteDeviation,
        verdict: verdictFor(r),
        ...(stream.tier === "A" ? { caveat: TIER_A_CAVEAT } : {}),
        ...(GROSS_ONLY ? { grossOnly: true } : {}),
      });
      verdictLines.push(describeVerdict(r));
      console.log(
        `  ${cell.padEnd(16)} n=${String(s.n).padStart(4)} i=${String(iterations).padStart(4)} ` +
          `avgR ${s.avgR.toFixed(3).padStart(7)} → pct ${r.percentileAvgR.toFixed(1).padStart(5)} ` +
          `(null med ${r.medianNullAvgR.toFixed(3)}) ${verdictFor(r)}  [${secs.toFixed(1)}s]`,
      );
    }
  }

  /* ── 4. Correlation and effective sample size ──
     "16 stream-years, all losing" reads as sixteen independent confirmations.
     MES and MNQ are both US equity index futures; intraday they are close to
     one instrument. The losing result stands either way — but its STRENGTH
     has to be quoted against effective N. */
  const correlationRows: CorrelationRow[] = [];
  const mes = barsBySymbol.get("MES");
  const mnq = barsBySymbol.get("MNQ");
  if (mes && mnq) {
    const c = summariseCorrelation(mes, mnq);
    const perSymbol = grossNetRows
      .filter((r) => r.stream.startsWith("B:"))
      .reduce((s, r) => s + r.trades, 0);
    correlationRows.push({
      pair: "MES/MNQ",
      ...c,
      nominalTrades: perSymbol,
      effectiveTrades: effectiveSampleSize(perSymbol / 2, 2, c.overall),
    });
    console.log(
      "\n" +
        describeEffectiveN(
          perSymbol,
          effectiveSampleSize(perSymbol / 2, 2, c.overall),
          "tier-B trades",
        ),
    );
  }

  console.log("\n── Gross vs net (two runs, not one book plus costs) ──");
  console.table(
    grossNetRows.map((r) => ({
      stream: r.stream,
      trades: r.trades,
      gross: r.grossTotal,
      net: r.netTotal,
      "gross/trade": num(r.grossPerTrade),
      "net/trade": num(r.netPerTrade),
      qty: `${r.minQty}–${r.maxQty} (µ ${num(r.meanQty)})`,
      "$/contract": num(r.frictionPerContract),
      "modelled cost": r.modelledCost,
      "measured drag": r.measuredDrag,
      "cost share": `${(r.costShareOfLoss * 100).toFixed(0)}%`,
      "same signals": `${r.sameSignals}/${r.trades}`,
    })),
  );
  console.log("\n── Excursion ──");
  console.table(
    excursionRows.map((r) => ({
      stream: r.stream,
      n: r.n,
      reliable: r.reliable,
      maeR: num(r.avgMaeR, 3),
      mfeR: num(r.avgMfeR, 3),
      maeATR: num(r.avgMaeAtr, 3),
      mfeATR: num(r.avgMfeAtr, 3),
      edge: num(r.edgeRatio, 3),
      "edge win": num(r.edgeRatioWinners, 3),
      "edge lose": num(r.edgeRatioLosers, 3),
      "min→MAE": num(r.avgMinutesToMae, 1),
      "min→MFE": num(r.avgMinutesToMfe, 1),
    })),
  );
  console.log("\n── Correlation and effective N ──");
  console.table(
    correlationRows.map((r) => ({
      pair: r.pair,
      overall: num(r.overall, 3),
      "median rolling": num(r.medianRolling, 3),
      "min rolling": num(r.minRolling, 3),
      ">0.8 share": `${(r.shareAbove80 * 100).toFixed(0)}%`,
      nominal: r.nominalTrades,
      effective: Math.round(r.effectiveTrades),
    })),
  );
  console.log("\n── Random-entry null ──");
  console.table(
    cells.map((c) => ({
      cell: c.cell,
      trades: c.realTrades,
      "real avgR": c.realAvgR.toFixed(3),
      "null median": c.medianNullAvgR.toFixed(3),
      "null p95": c.p95NullAvgR.toFixed(3),
      percentile: c.percentileAvgR.toFixed(1),
      p: c.pValueAvgR.toFixed(4),
      "realised N": `${(c.realisedNRatio * 100).toFixed(0)}%`,
      verdict: c.verdict,
    })),
  );

  const beat = cells.filter((c) => c.verdict === "beats-random").length;
  console.log(
    `\nVERDICT: ${beat} of ${cells.length} cells beat matched random entries at the 95th percentile.`,
  );
  for (const line of verdictLines) console.log(`  · ${line}`);

  const allBars = [...barsBySymbol.values()].flat();
  const stamp = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const payload: Phase1Report = {
    generatedFrom: "scripts/diag/random-entry.ts",
    measuredAt: new Date().toISOString(),
    barSource: BAR_SOURCE,
    iterations: ITERATIONS,
    mode: MODE,
    costModel: LEGACY_MODEL.id,
    windowFrom: allBars.length ? stamp(Math.min(...allBars.map((b) => b.time))) : "",
    windowTo: allBars.length ? stamp(Math.max(...allBars.map((b) => b.time))) : "",
    grossNet: grossNetRows,
    excursion: excursionRows,
    randomEntry: cells,
    correlation: correlationRows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${OUT}`);

  /* --sql prints the INSERTs for research_baselines rather than executing
     them. Writing needs the service-role key, and this script is read-only by
     design; printing keeps it that way while still making the persistence step
     reproducible by anyone with access. The same pattern backfill-fill-audit.ts
     uses.

     research_baselines is append-only (a trigger, not a policy — the engine's
     service-role key bypasses RLS but not triggers), so re-running this after a
     config change inserts a NEW row and leaves the old measurement visible.
     That is the point: the losing baseline is the control. */
  if (process.argv.includes("--sql")) {
    console.log("\n── SQL to persist the immutable baseline ──");
    for (const r of grossNetRows) {
      const ex = excursionRows.find((e) => e.stream === r.stream);
      const cellsFor = cells.filter((c) => c.stream === r.stream);
      const hash = stableHash({
        stream: r.stream,
        execution: EXECUTION,
        costModel: LEGACY_MODEL.id,
        source: BAR_SOURCE,
        from: payload.windowFrom,
        to: payload.windowTo,
        grossOnly: GROSS_ONLY,
      });
      const j = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      console.log(
        `insert into public.research_baselines
  (baseline_key, config_hash, bar_source, symbol, window_from, window_to, gross, net, excursion, random_entry, provenance)
values ('${r.stream}', '${hash}', '${BAR_SOURCE}', '${r.stream.replace("B:", "")}',
  '${payload.windowFrom}', '${payload.windowTo}',
  ${j({ total: r.grossTotal, perTrade: r.grossPerTrade, trades: r.trades })},
  ${j({ total: r.netTotal, perTrade: r.netPerTrade, trades: r.trades, meanQty: r.meanQty })},
  ${j(ex ?? {})},
  ${j(cellsFor.map((c) => ({ cell: c.cell, pct: c.percentileAvgR, verdict: c.verdict })))},
  'Phase 1 truth layer, ${payload.measuredAt.slice(0, 10)}: ${ITERATIONS} random-entry iterations ` +
          `per cell on ${BAR_SOURCE} bars ${payload.windowFrom} to ${payload.windowTo}. ` +
          `Gross ${r.grossTotal}, net ${r.netTotal}, cost share ${(r.costShareOfLoss * 100).toFixed(0)}%. ` +
          `Reproduce: BAR_SOURCE=${BAR_SOURCE} npx tsx scripts/diag/random-entry.ts --iterations ${ITERATIONS}')
on conflict (baseline_key, config_hash) do nothing;`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
