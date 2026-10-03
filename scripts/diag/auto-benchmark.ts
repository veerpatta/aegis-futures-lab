/* Weekly self-research: measure one "not tested yet" method against matched
 * random entries, record the result, and REPORT it. Never promotes.
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The app shows a method as UNMEASURED (amber, "not tested yet") until someone
 * runs the beat-random test on it. Until 2026-10-03 four classics sat in that
 * state by accident, and nothing would ever have measured them. This job does,
 * one method per run, so the bot keeps auditing its own untested ideas instead
 * of leaving them amber forever.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not edit lib/strategies (standing lives in research-standing.json,
 * which a person moves), does not touch tiers.ts or any release, and does not
 * tune anything. A method that beats random here has passed a SCREEN, not the
 * promotion gate (lib/validation/promotionGate.ts) — the full gate, separate
 * confirmation and 60 new trades are still required, and a person starts them.
 * The trial outcome therefore always records gate.promote = false.
 *
 * HOW IT STAYS HONEST
 *
 * - Preregistered: the research_trials row (hypothesis, prediction, decision
 *   rule, config hash) is written BEFORE the measurement. The table makes
 *   those fields and the outcome write-once.
 * - Measured once per code version: the config hash includes the research
 *   code hash, so a method is not re-measured weekly on the same code. Every
 *   trial counts toward the multiple-testing total later research must clear,
 *   which is correct and is the reason re-runs are not free.
 * - Same machinery and cost model as Phase 1 and the gold benchmark
 *   (runGrossNet, runNullDistribution, verdictFor; LEGACY_MODEL), so its
 *   percentiles are comparable with the existing baselines.
 * - Appends to research_baselines (append-only by trigger).
 *
 * Run: BAR_SOURCE=databento DATABASE_URL=… npx tsx scripts/diag/auto-benchmark.ts
 *   --iterations 200   matched-random iterations per cell (default 200)
 *   --dry-run          choose and describe the method, measure nothing, write nothing
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient, transaction } from "@/lib/neon/server";
import type { Bar } from "@/lib/types";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import { runGrossNet } from "@/lib/backtest/grossNet";
import { alignArchiveSlice } from "@/lib/data/window";
import { assertArchivePresent, fetchArchiveBars } from "@/lib/data/archive";
import { parseBarSource } from "@/lib/data/source";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { nyMeta } from "@/lib/time/ny";
import { LEGACY_MODEL } from "@/lib/costs";
import { bootstrapGeometry, candidatePool, profileFrom, type SessionWindow } from "@/lib/diagnostics/randomEntry";
import { describeVerdict, runNullDistribution, verdictFor } from "@/lib/diagnostics/randomEntryRun";
import { STRATEGIES, feedsFor, isUnmeasured } from "@/lib/strategies/registry";
import { RESEARCH_IDS } from "@/lib/strategies/research-v2";
import { ROUND3_IDS } from "@/lib/strategies/research-round3";
import { defaultParams, type Strategy } from "@/lib/strategies/types";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL } from "@/scripts/engine/tiers";
import { stableHash } from "@/scripts/engine/learning-audit";
import { researchCodeHash } from "@/scripts/engine/research-code";
import { sendTelegram } from "@/scripts/engine/notify";
import { autoBenchmarkOutcome, type CellResult } from "@/lib/research/auto-benchmark";

const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ITERATIONS = Number(arg("--iterations", "200"));
const DRY_RUN = process.argv.includes("--dry-run");
const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
/* Research candidates have their own preregistered pipeline (research-v2.ts). */
const OWN_PIPELINE = new Set<string>([...RESEARCH_IDS, ...ROUND3_IDS]);

const supabase = createClient();

/* The strategy's own entry window, when it declares one; otherwise the pool is
   left unbounded and the minute-distribution deviation is reported, exactly as
   gold-benchmark.ts does. */
function sessionWindowFor(params: Record<string, unknown>): SessionWindow | null {
  if (params.session === "rth") return { fromMin: 570, toMin: SESSION_EXIT_MINUTE };
  if (params.session === "day") return { fromMin: 120, toMin: SESSION_EXIT_MINUTE };
  return null;
}

function requestFor(strategy: Strategy<unknown>, symbol: FeedSymbol, bars: Bar[]): RunRequest {
  return {
    strategyId: strategy.id,
    params: defaultParams(strategy),
    series: { [symbol]: bars },
    execution: { ...EXECUTION, tradableSymbols: [symbol] },
    locks: null,
    startingCapital: STARTING_CAPITAL,
    sessionExitMinute: SESSION_EXIT_MINUTE,
    pointValues: POINT_VALUES,
  };
}

function configHashFor(strategy: Strategy<unknown>): string {
  return stableHash({
    kind: "auto-benchmark",
    strategyId: strategy.id,
    params: defaultParams(strategy),
    execution: EXECUTION,
    costModel: LEGACY_MODEL.id,
    source: BAR_SOURCE,
    iterations: ITERATIONS,
    code: researchCodeHash(),
  });
}

async function pickStrategy(): Promise<Strategy<unknown> | null> {
  const eligible = STRATEGIES.filter(
    (s) => isUnmeasured(s.id) && !OWN_PIPELINE.has(s.id) && feedsFor(s).every((f) => SYMBOLS.includes(f))
  );
  for (const s of eligible) {
    const { rows } = await transaction((c) =>
      c.query("SELECT 1 FROM research_trials WHERE config_hash=$1 LIMIT 1", [configHashFor(s)])
    );
    if (!rows.length) return s;
  }
  return null;
}

async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  const raw = await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE });
  return alignArchiveSlice(assertArchivePresent(raw, { symbol, source: BAR_SOURCE, minBars: 100_000 }));
}

function sliceByYear(bars: Bar[]): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const b of bars) {
    const y = nyMeta(b.time).dateKey.slice(0, 4);
    (out.get(y) ?? out.set(y, []).get(y)!).push(b);
  }
  return out;
}

async function openIssue(title: string, body: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ title, body: body.slice(0, 60_000), labels: ["auto-benchmark"] }),
    });
    if (!res.ok) console.error(`issue create failed: ${res.status}`);
  } catch (e) {
    console.error(`issue create failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const strategy = await pickStrategy();
  if (!strategy) {
    console.log("Every untested method has already been measured on this code. Nothing to do.");
    return;
  }
  const params = defaultParams(strategy);
  const configHash = configHashFor(strategy);
  const day = new Date().toISOString().slice(0, 10);
  const trialKey = `auto-benchmark.${day}:${strategy.id}`;
  const hypothesis = `${strategy.name} (${strategy.id}) entries carry information beyond matched random entries on MES and MNQ.`;
  const prediction =
    "If the entries carry information, the real book's average R sits at or above the 95th percentile of matched random entries in the all-years cell of each market.";
  const decisionRule =
    "beats-random only if every judged all-years cell (n >= 30) is at or above the 95th percentile AND at least half of the judged symbol-years are too; " +
    "no-edge if any judged all-years cell is below the 95th percentile; insufficient-sample if no all-years cell has 30 trades. " +
    "A screen, not the promotion gate: gate.promote is always false.";

  console.log(`\nAuto-benchmark: ${strategy.name} (${strategy.id}) · source=${BAR_SOURCE} · iterations=${ITERATIONS}\n`);
  if (DRY_RUN) {
    console.log({ trialKey, configHash, params, hypothesis, prediction, decisionRule });
    return;
  }

  // Preregistration first, committed before anything is measured.
  await transaction((c) =>
    c.query(
      `INSERT INTO research_trials(trial_key,hypothesis,prediction,decision_rule,config_hash,params,dataset,code_sha,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running')`,
      [
        trialKey,
        hypothesis,
        prediction,
        decisionRule,
        configHash,
        JSON.stringify(params),
        JSON.stringify({ source: BAR_SOURCE, symbols: SYMBOLS, iterations: ITERATIONS, costModel: LEGACY_MODEL.id }),
        process.env.GITHUB_SHA ?? null,
      ]
    )
  );

  const cells: CellResult[] = [];
  const baselines: { symbol: string; gross: unknown; net: unknown; random: unknown; from: string; to: string }[] = [];
  const window = sessionWindowFor(params as Record<string, unknown>);
  for (const symbol of SYMBOLS) {
    const bars = await archiveBars(symbol);
    console.log(`  loaded ${symbol}: ${bars.length.toLocaleString()} bars`);
    const slices: { label: string; bars: Bar[]; allYears: boolean }[] = [{ label: `${symbol}:all`, bars, allYears: true }];
    for (const [year, yb] of [...sliceByYear(bars).entries()].sort()) if (yb.length >= 5_000) slices.push({ label: `${symbol}:${year}`, bars: yb, allYears: false });
    const symbolCells: CellResult[] = [];
    let allGross: unknown = null;
    for (const slice of slices) {
      const req = requestFor(strategy, symbol, slice.bars);
      const gn = await runGrossNet(req, executeRun, LEGACY_MODEL);
      const trades = gn.net.trades;
      if (slice.allYears) allGross = { total: gn.grossNetTotal, trades: trades.length };
      if (!trades.length) {
        symbolCells.push({ cell: slice.label, symbol, allYears: slice.allYears, n: 0, net: 0, percentile: null, verdict: "insufficient-sample" });
        continue;
      }
      const res = runNullDistribution(
        {
          cell: slice.label,
          series: req.series,
          execution: req.execution,
          locks: null,
          startingCapital: STARTING_CAPITAL,
          sessionExitMinute: SESSION_EXIT_MINUTE,
          pointValues: POINT_VALUES,
          sessionWindow: window,
          profile: profileFrom(trades),
          geometry: bootstrapGeometry(trades),
          mode: "matchDayCounts",
          iterations: ITERATIONS,
        },
        trades,
        candidatePool(req.series, window)
      );
      const verdict = verdictFor(res);
      console.log(`  ${slice.label.padEnd(10)} n=${String(res.real.n).padStart(5)}  pct=${res.percentileAvgR.toFixed(1).padStart(5)}  ${verdict}`);
      symbolCells.push({
        cell: slice.label,
        symbol,
        allYears: slice.allYears,
        n: res.real.n,
        net: res.real.net,
        percentile: res.percentileAvgR,
        verdict,
        describe: describeVerdict(res),
      });
    }
    cells.push(...symbolCells);
    const all = symbolCells.find((c) => c.allYears)!;
    baselines.push({
      symbol,
      gross: allGross,
      net: { total: all.net, trades: all.n },
      random: symbolCells.map((c) => ({ cell: c.cell, pct: c.percentile, verdict: c.verdict })),
      from: nyMeta(bars[0].time).dateKey,
      to: nyMeta(bars[bars.length - 1].time).dateKey,
    });
  }

  const outcome = autoBenchmarkOutcome(strategy.id, cells);
  await transaction(async (c) => {
    await c.query(`UPDATE research_trials SET outcome=$2,status='complete',decided_at=now() WHERE trial_key=$1 AND outcome IS NULL`, [
      trialKey,
      JSON.stringify(outcome),
    ]);
    for (const b of baselines)
      await c.query(
        `INSERT INTO research_baselines(baseline_key,config_hash,code_sha,bar_source,symbol,window_from,window_to,gross,net,random_entry,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (baseline_key, config_hash) DO NOTHING`,
        [
          `auto:${strategy.id}:${b.symbol}`,
          configHash,
          process.env.GITHUB_SHA ?? null,
          BAR_SOURCE,
          b.symbol,
          b.from,
          b.to,
          JSON.stringify(b.gross ?? {}),
          JSON.stringify(b.net),
          JSON.stringify(b.random),
          `Weekly auto-benchmark ${day}: ${ITERATIONS} matched-random iterations per cell, ${LEGACY_MODEL.id} costs. Trial ${trialKey}.`,
        ]
      );
  });

  const summary =
    `${outcome.headline}\n\n` +
    cells.map((c) => `- ${c.cell}: n=${c.n}, ${c.percentile === null ? "—" : `${c.percentile.toFixed(1)}th percentile`}, ${c.verdict}`).join("\n") +
    `\n\n${outcome.nextStep}\n\nTrial \`${trialKey}\` · config \`${configHash.slice(0, 12)}\` · paper only, delayed data.`;
  console.log(`\n${summary}\n`);
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/auto-benchmark.json", JSON.stringify({ trialKey, configHash, outcome, cells }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Weekly auto-benchmark\n\n${summary}\n`);
  await sendTelegram(`🔬 <b>Weekly auto-benchmark</b>: ${outcome.headline}`);
  await openIssue(`Auto-benchmark: ${strategy.name} — ${outcome.verdict}`, summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
