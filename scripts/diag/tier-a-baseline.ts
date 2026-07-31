/* Tier-A baseline on the DAY-ALIGNED archive — the number that replaces a
   measurement which no longer reproduces.

   Why this is a measurement and NOT a grid search
   ───────────────────────────────────────────────
   The `tiers.ts` header promised 0.3–0.4 trades/day at PF ≈ 1.35. That figure
   came through `report.ts --archive`, which sliced the bar archive at an
   arbitrary instant and was therefore exposed to the truncated-first-daily-bar
   defect fixed in lib/data/window.ts. It does not reproduce, so tier A's
   parameters currently rest on a number that no longer exists.

   The obvious next move — grid-search tier A's params — is the wrong one, and
   the codebase already says so in two places: `challengerFor` refuses tier A
   outright ("no candidate grid for this stream"), and tune.ts's header calls a
   grid at ~0.3 trades/day "a curve-fitting machine". Phase 1 made it worse than
   either assumed: tier A's trades are not spread thinly, they are ONE clustered
   session out of fifty. A grid over that is not a retune of a strategy, it is a
   fit to 2026-07-09.

   So this script produces the honest replacement: what tier A actually does on
   the aligned archive, with the distribution rather than just the mean (the mean
   is the misleading statistic when everything lands on one day), and a
   robustness check across window shifts — because "reproducible" is the whole
   point of the exercise.

   Read-only. Changes no parameter. Run with:
     npx tsx scripts/diag/tier-a-baseline.ts */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { alignArchiveSlice } from "@/lib/data/window";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { nyMeta } from "@/lib/time/ny";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { parseBarSource } from "@/lib/data/source";
import {
  EXECUTION,
  SESSION_EXIT_MINUTE,
  STARTING_CAPITAL,
  TUNING_BASELINE,
  tierStreams,
} from "@/scripts/engine/tiers";

/* Which feed to measure. Defaults to yahoo so the documented numbers keep
   reproducing; BAR_SOURCE=databento re-measures the same thing on the real
   CME contracts. Comparing the two is the point of having both. */
const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);

const PAGE = 1000;
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .eq("source", BAR_SOURCE)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read for ${symbol}: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < PAGE) break;
  }
  return alignArchiveSlice(out);
}

function tierA() {
  const s = tierStreams().find((x) => x.tier === "A");
  if (!s) throw new Error("no tier A stream configured");
  return s;
}

const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "∞");

/* Trading sessions in a series: NY weekdays with at least one RTH bar. The
   denominator for trades/day, and the population for the distribution. */
function sessionsIn(bars: Bar[]): string[] {
  const days = new Set<string>();
  for (const b of bars) {
    const m = nyMeta(b.time);
    if (m.weekday !== "Sat" && m.weekday !== "Sun" && m.minutes >= 570 && m.minutes < 925)
      days.add(m.dateKey);
  }
  return [...days].sort();
}

function runTierA(series: Record<string, Bar[]>) {
  const stream = tierA();
  return executeRun({
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
  });
}

async function main() {
  const full: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) full[s] = await archiveBars(s);
  const stream = tierA();
  const series = Object.fromEntries(stream.symbols.map((s) => [s, full[s]]));

  const sessions = sessionsIn(full.MES);
  console.log(
    `\n=== day-aligned archive ===\n` +
      `MES ${full.MES.length} bars · MNQ ${full.MNQ.length} bars · ` +
      `${sessions.length} trading sessions (${sessions[0]} → ${sessions[sessions.length - 1]})`
  );

  const res = runTierA(series);
  const m = res.metrics;

  // ── The headline baseline ────────────────────────────────────────────────
  console.log(`\n=== tier A baseline (params unchanged) ===`);
  console.table([
    {
      trades: m.trades,
      sessions: sessions.length,
      "trades/day (mean)": num(m.trades / Math.max(1, sessions.length), 3),
      wins: m.wins,
      losses: m.losses,
      "win%": num(m.winRate, 1),
      PF: num(m.profitFactor),
      net: `$${num(m.net, 0)}`,
      maxDD: `$${num(m.maxDrawdown, 0)}`,
      "avg R": num(m.avgR, 3),
      expectancy: `$${num(m.expectancy, 2)}`,
    },
  ]);

  // ── The distribution, which is the honest statistic here ─────────────────
  const byDay = new Map<string, { n: number; net: number }>();
  for (const t of res.trades) {
    const k = nyMeta(t.entryTime).dateKey;
    const cur = byDay.get(k) ?? { n: 0, net: 0 };
    cur.n++;
    cur.net += t.pnl;
    byDay.set(k, cur);
  }
  const active = [...byDay.entries()].sort();
  console.log(`\n=== distribution: which sessions actually traded ===`);
  console.table(
    active.map(([day, v]) => ({
      session: day,
      trades: v.n,
      net: `$${num(v.net, 0)}`,
      "share of all trades": `${num((100 * v.n) / Math.max(1, m.trades), 0)}%`,
    }))
  );
  console.log(
    `${active.length} of ${sessions.length} sessions produced a trade ` +
      `(${num((100 * active.length) / Math.max(1, sessions.length), 1)}%). ` +
      `The mean trades/day above is therefore NOT a rate — it is ` +
      `${m.trades} trades on ${active.length} day(s) divided by ${sessions.length}.`
  );

  // ── Per symbol ───────────────────────────────────────────────────────────
  console.log(`\n=== per symbol ===`);
  console.table(
    stream.symbols.map((s) => {
      const im = res.byInstrument[s];
      return im
        ? {
            symbol: s,
            trades: im.trades,
            "win%": num(im.winRate, 1),
            PF: num(im.profitFactor),
            net: `$${num(im.net, 0)}`,
          }
        : { symbol: s, trades: 0, "win%": "—", PF: "—", net: "$0" };
    })
  );

  // ── Robustness: is the number reproducible now? ───────────────────────────
  // The point of the P1 fix. Before alignment a 13-hour window shift moved tier
  // A's trade count 7-fold; if the baseline is to mean anything it must hold
  // still under the same kind of shift.
  console.log(`\n=== robustness: trailing 60d window slid back day by day ===`);
  const endSec = Math.max(...SYMBOLS.map((s) => full[s][full[s].length - 1].time));
  const rows: Record<string, string | number>[] = [];
  for (let back = 0; back <= 10; back++) {
    const to = endSec - back * 86400;
    const from = to - 60 * 86400;
    const win = Object.fromEntries(
      stream.symbols.map((s) => [s, full[s].filter((b) => b.time >= from && b.time <= to)])
    );
    if (Object.values(win).some((b) => !b.length)) continue;
    const r = runTierA(win);
    rows.push({
      "window end": nyMeta(to).dateKey,
      sessions: sessionsIn(win.MES).length,
      trades: r.metrics.trades,
      PF: num(r.metrics.profitFactor),
      net: `$${num(r.metrics.net, 0)}`,
      qualified: r.skipReasons.qualified ?? 0,
      invalidFill: r.skipReasons.invalidFill ?? 0,
    });
  }
  console.table(rows);
  const spread = (k: string) => {
    const vals = rows.map((r) => Number(r[k]));
    return `${Math.min(...vals)}–${Math.max(...vals)}`;
  };
  console.log(
    `across ${rows.length} one-day shifts: trades ${spread("trades")}, ` +
      `qualified ${spread("qualified")}, invalidFill ${spread("invalidFill")}`
  );

  // ── What the dashboard currently promises ────────────────────────────────
  const promised = TUNING_BASELINE.find((b) => b.key === "A");
  console.log(`\n=== vs the band the dashboard shows ===`);
  console.log(
    `promised: PF ${promised?.pfBand[0]}–${promised?.pfBand[1]} · ` +
      `${promised?.tradesPerDay[0]}–${promised?.tradesPerDay[1]} trades/day`
  );
  console.log(
    `measured: PF ${num(m.profitFactor)} · ` +
      `${num(m.trades / Math.max(1, sessions.length), 3)} trades/day mean, ` +
      `clustered on ${active.length} of ${sessions.length} sessions`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
