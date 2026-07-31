/* Tier-B baseline — the measurement nobody had taken.
   ─────────────────────────────────────────────────────────────────────────
   Tier A got seven years of real CME data (commit 0a9fea1) and printed PF
   0.55 over 1,180 trades. Tier B never got the same treatment, and it is the
   stream that matters more right now: it is the ONLY one with live trades,
   and its bands in TUNING_BASELINE come from the same 60-day Yahoo tuning
   window that produced tier A's refuted band.

   "Tier B was re-checked on the day-aligned archive at PF 1.41 / 1.25" is a
   check over 51 sessions of delayed proxy data. This runs the identical
   configuration — live params, live per-symbol locks, live maxRisk — over the
   whole Databento archive, 2,254 sessions per symbol, and prints the recent
   60-day slice beside it so the two can be read against each other. If the
   long-run figure agrees with the tuning window, the band is confirmed on
   out-of-sample data. If it does not, the band is a fit, and the dashboard is
   making a promise the data does not support.

   Both streams are run SEPARATELY, one symbol each, because that is how
   tierStreams() defines them: rsi-reversion on MES with B_LOCKS, and on MNQ
   with the dailyLoss-202 variant. Running them combined would share a lock
   ledger they do not share live, and the numbers would not be the bot's.

   Read-only. Changes no parameter. Run with:
     npx tsx scripts/diag/tier-b-baseline.ts
     BAR_SOURCE=databento npx tsx scripts/diag/tier-b-baseline.ts */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { alignArchiveSlice } from "@/lib/data/window";
import { dropSeamSessions } from "@/lib/data/feed-delta";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { nyMeta } from "@/lib/time/ny";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { parseBarSource } from "@/lib/data/source";
import { fetchArchiveBars } from "@/lib/data/archive";
import {
  EXECUTION,
  SESSION_EXIT_MINUTE,
  STARTING_CAPITAL,
  TUNING_BASELINE,
  type TierStream,
  tierStreams,
} from "@/scripts/engine/tiers";

/* Same switch tier-a-baseline.ts and atr-ratio.ts use: yahoo by default so the
   documented numbers keep reproducing, databento for the real contracts. */
const BAR_SOURCE = parseBarSource(process.env.BAR_SOURCE);

const PAGE = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

/* Day-align even though rsi-reversion builds no multi-day frame: the archive
   read is the same shape as every other, and a reader that skips the trim on
   the grounds that it happens not to need it is how tune-core.ts was missed
   (tests/archive-window.test.ts documents that miss). */
async function archiveBars(symbol: FeedSymbol): Promise<Bar[]> {
  return alignArchiveSlice(await fetchArchiveBars(supabase, { symbol, source: BAR_SOURCE }));
}

const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "∞");

/** Trading sessions in a series: NY weekdays with at least one RTH bar. */
function sessionsIn(bars: Bar[]): string[] {
  const days = new Set<string>();
  for (const b of bars) {
    const m = nyMeta(b.time);
    if (m.weekday !== "Sat" && m.weekday !== "Sun" && m.minutes >= 570 && m.minutes < 925)
      days.add(m.dateKey);
  }
  return [...days].sort();
}

function runStream(stream: TierStream, bars: Bar[]) {
  return executeRun({
    strategyId: stream.strategyId,
    params: stream.params,
    series: Object.fromEntries(stream.symbols.map((s) => [s, bars])),
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

interface Row {
  stream: string;
  window: string;
  sessions: number;
  trades: number;
  "trades/day": string;
  "win%": string;
  PF: string;
  net: string;
  maxDD: string;
  "avg R": string;
  expectancy: string;
}

function summarise(label: string, window: string, stream: TierStream, bars: Bar[]): Row | null {
  if (!bars.length) return null;
  const sessions = sessionsIn(bars).length;
  const m = runStream(stream, bars).metrics;
  return {
    stream: label,
    window,
    sessions,
    trades: m.trades,
    "trades/day": num(m.trades / Math.max(1, sessions), 3),
    "win%": num(m.winRate, 1),
    PF: num(m.profitFactor),
    net: `$${num(m.net, 0)}`,
    maxDD: `$${num(m.maxDrawdown, 0)}`,
    "avg R": num(m.avgR, 3),
    expectancy: `$${num(m.expectancy, 2)}`,
  };
}

async function main() {
  const streams = tierStreams().filter((s) => s.tier === "B");
  if (!streams.length) throw new Error("no tier B streams configured");

  console.log(`\n=== tier B on the ${BAR_SOURCE} archive ===`);

  const rows: Row[] = [];
  const perStream: { stream: TierStream; label: string; bars: Bar[]; sessions: number }[] = [];

  for (const stream of streams) {
    if (stream.symbols.length !== 1)
      throw new Error(`tier B stream ${stream.label} trades ${stream.symbols.length} symbols — ` +
        `this script assumes one, because the live locks are per symbol`);
    const symbol = stream.symbols[0];
    const label = `B:${symbol}`;
    const bars = await archiveBars(symbol);
    const sessions = sessionsIn(bars);
    perStream.push({ stream, label, bars, sessions: sessions.length });
    console.log(
      `${label}: ${bars.length} bars · ${sessions.length} sessions ` +
        `(${sessions[0]} → ${sessions[sessions.length - 1]}) · ` +
        `dailyLoss lock $${stream.locks?.dailyLoss ?? "—"}, maxRisk $${stream.maxRisk ?? EXECUTION.maxRisk}`
    );

    const full = summarise(label, "full archive", stream, bars);
    if (full) rows.push(full);

    /* Seam-excluded, closing the caveat the backfill commit opened. A
       continuous contract is stitched roughly 29 times over seven years, and
       each stitch is a price discontinuity. This drops every session whose
       open gaps more than 1.5× the trailing session range from the previous
       close, plus the session after it. If the headline figure only holds
       because of stitched prices, this row is where it shows. */
    const { bars: clean, dropped } = dropSeamSessions(bars, (t) => nyMeta(t).dateKey);
    const seamFree = summarise(label, "seam-excluded", stream, clean);
    if (seamFree) rows.push(seamFree);
    console.log(
      `  ${label}: ${dropped.length} of ${sessions.length} sessions dropped as roll seams ` +
        `(${((100 * dropped.length) / Math.max(1, sessions.length)).toFixed(1)}%)`
    );

    /* The recent slice, so the long-run figure can be read beside the window
       the band was tuned on. Tier A's Databento recent-60d windows printed
       0.84–0.97 against Yahoo's 0.86 — the feeds agreed. The same check
       belongs here before any conclusion is drawn about tier B. */
    const endSec = bars[bars.length - 1].time;
    const recent = bars.filter((b) => b.time >= endSec - 60 * 86400);
    const r60 = summarise(label, "recent 60d", stream, recent);
    if (r60) rows.push(r60);
  }

  console.log(`\n=== headline ===`);
  console.table(rows);

  /* Per-year, because a seven-year mean can hide a strategy that worked once
     and has not since — the shape tier A turned out to have on a daily scale. */
  console.log(`\n=== by calendar year ===`);
  const byYear: Record<string, string | number>[] = [];
  for (const { stream, label, bars } of perStream) {
    const years = [...new Set(bars.map((b) => nyMeta(b.time).dateKey.slice(0, 4)))].sort();
    for (const y of years) {
      const slice = bars.filter((b) => nyMeta(b.time).dateKey.startsWith(y));
      const sessions = sessionsIn(slice).length;
      if (sessions < 20) continue; // a stub year says nothing
      const m = runStream(stream, slice).metrics;
      byYear.push({
        stream: label,
        year: y,
        sessions,
        trades: m.trades,
        "win%": num(m.winRate, 1),
        PF: num(m.profitFactor),
        net: `$${num(m.net, 0)}`,
        "avg R": num(m.avgR, 3),
      });
    }
  }
  console.table(byYear);

  const losingYears = byYear.filter((r) => Number(r.PF) < 1).length;
  console.log(
    `${losingYears} of ${byYear.length} stream-years print PF below 1.0. ` +
      `A band is only meaningful if the stream reaches it in more than one regime.`
  );

  console.log(`\n=== vs the bands the dashboard shows ===`);
  for (const { label } of perStream) {
    const promised = TUNING_BASELINE.find((b) => b.key === label);
    const measured = rows.find((r) => r.stream === label && r.window === "full archive");
    if (!promised || !measured) continue;
    console.log(
      `${label} promised PF ${promised.pfBand[0]}–${promised.pfBand[1]} · ` +
        `${promised.tradesPerDay[0]}–${promised.tradesPerDay[1]}/day` +
        `  →  measured PF ${measured.PF} · ${measured["trades/day"]}/day ` +
        `over ${measured.sessions} sessions (${measured.trades} trades, net ${measured.net})`
    );
  }
  console.log(
    `\nprovenance line for tiers.ts:\n` +
      perStream
        .map(({ label }) => {
          const m = rows.find((r) => r.stream === label && r.window === "full archive");
          return m
            ? `  ${label}: ${m.trades} trades over ${m.sessions} sessions, PF ${m.PF}, ` +
                `net ${m.net}, avg R ${m["avg R"]} (${BAR_SOURCE})`
            : `  ${label}: no rows`;
        })
        .join("\n")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
