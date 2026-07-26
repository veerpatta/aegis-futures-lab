/* Weekly research — Hypothesis 2: TIME-OF-DAY AND DAY-OF-WEEK EXPECTANCY.

   WHAT IT ASKS
   ────────────
   Do specific NY hours or weekdays carry reliably negative expectancy across
   streams — a restriction (drop the worst hours) rather than an addition
   (a new parameter), per the standing brief's preference?

   HYPOTHESIS (falsifiable)
   ─────────────────────────
   H2: "There exists an hour-of-day or day-of-week bucket, identified from
   train-slice data, whose exclusion improves combined expectancy on
   held-out validation data."

   WHAT WOULD REFUTE IT
   ─────────────────────
   Identify the worst bucket(s) (most negative expectancy, n >= 15) on the
   TRAIN slice. Recompute combined expectancy on the VALIDATION slice with
   and without that bucket. If validation expectancy does NOT improve when
   the bucket is dropped — or the bucket's sign flips between train and
   validation — H2 is refuted for that bucket: the train-set pattern did not
   generalize. Report every bucket's numbers on both slices regardless of
   outcome, and say "insufficient" wherever n is too small to trust.

   METHOD — POOLING FOR n
   ───────────────────────
   Per-stream n over one ~10-week archive is in the tens (tier A: 16 over 51
   sessions). To reach the hundreds the standing brief asks for, this script
   pools EVERY configured stream run over the SAME full day-aligned archive:
   the two live tier-B streams, tier A, and the three active shadow-audition
   strategies (vwap-reversion, orb, bollinger-breakout) per symbol — the
   exact roster and config shadow.ts runs live (defaultParams, nextOpen fill,
   B_LOCKS, same session/point-value config). ema-cross is EXCLUDED: it was
   retired 2026-07-25 (2 of 28 closed profitable, net -$2,718) precisely
   because its numbers were bad and mislabelled — folding it back in here
   would launder a known-broken stream into a "restrict the hours" finding.
   Pooling different strategies' hourly patterns together answers "is there a
   structurally bad hour across this shop", not "for this one strategy" —
   both readings are reported (combined AND per-stream) so a bucket that is
   an artifact of one strategy dominating doesn't get mistaken for a
   cross-stream effect.
   Doubtful fills (tier A only — all others are nextOpen, never doubtful) are
   dropped before bucketing.

   REPRODUCE
   ─────────
     npx tsx scripts/diag/time-of-day-expectancy.ts
   Read-only: no writes, no parameter changes. */

import type { Bar, Trade } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { auditFill } from "@/scripts/engine/fill-audit";
import { nyMeta } from "@/lib/time/ny";
import { defaultParams } from "@/lib/strategies/types";
import { strategyById } from "@/lib/strategies/registry";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { B_LOCKS, EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "@/scripts/engine/tiers";
import { archiveBars, num, sessionsIn } from "./archive-lib";

const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const SHADOW_STRATEGIES = ["vwap-reversion", "orb", "bollinger-breakout"] as const;
const TRAIN_FRACTION = 0.7;
const MIN_N = 15; // below this, a bucket is reported but flagged insufficient

interface TaggedTrade {
  stream: string;
  symbol: string;
  hour: number;
  weekday: string;
  pnl: number;
  entryTime: number;
}

function tag(stream: string, trades: Trade[]): TaggedTrade[] {
  return trades.map((t) => {
    const m = nyMeta(t.entryTime);
    return { stream, symbol: t.symbol, hour: m.hour, weekday: m.weekday, pnl: t.pnl, entryTime: t.entryTime };
  });
}

function dropDoubtfulLimitFills(stream: string, trades: Trade[], bars: Record<string, Bar[]>): Trade[] {
  return trades.filter((t) => {
    const conf = auditFill({
      fillModel: "limit",
      direction: t.side === "LONG" ? "long" : "short",
      limit: t.entryPrice,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      bars: bars[t.symbol],
    });
    return conf !== "doubtful";
  });
}

async function main() {
  const full: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) full[s] = await archiveBars(s);
  const sessions = sessionsIn(full.MES);
  const splitDay = sessions[Math.floor(sessions.length * TRAIN_FRACTION)];
  console.log(
    `archive: ${sessions.length} sessions (${sessions[0]} → ${sessions[sessions.length - 1]}), ` +
      `train/validation split at ${splitDay} (${sessions.filter((d) => d < splitDay).length}/` +
      `${sessions.filter((d) => d >= splitDay).length} sessions)`
  );

  const all: TaggedTrade[] = [];
  const perStreamCounts: Record<string, number> = {};

  // ── Tier streams (live config, unchanged) ────────────────────────────────
  for (const streamKey of ["A", "B:MES", "B:MNQ"]) {
    const stream = tierStreams().find(
      (s) => (s.tier === "A" ? "A" : `B:${s.symbols.join("+")}`) === streamKey
    )!;
    const series = Object.fromEntries(stream.symbols.map((s) => [s, full[s]]));
    const res = executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series,
      execution: { ...EXECUTION, fillModel: stream.fillModel, maxRisk: stream.maxRisk ?? EXECUTION.maxRisk },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      pointValues: POINT_VALUES,
    });
    const trades = stream.fillModel === "limit" ? dropDoubtfulLimitFills(streamKey, res.trades, full) : res.trades;
    perStreamCounts[`tier-${streamKey}`] = trades.length;
    all.push(...tag(`tier-${streamKey}`, trades));
  }

  // ── Shadow audition strategies (same config shadow.ts runs live) ─────────
  for (const strategyId of SHADOW_STRATEGIES) {
    for (const symbol of SYMBOLS) {
      const strategy = strategyById(strategyId);
      const res = executeRun({
        strategyId,
        params: defaultParams(strategy),
        series: { [symbol]: full[symbol] },
        execution: { ...EXECUTION, fillModel: "nextOpen" },
        locks: B_LOCKS,
        startingCapital: STARTING_CAPITAL,
        sessionExitMinute: SESSION_EXIT_MINUTE,
        pointValues: POINT_VALUES,
      });
      perStreamCounts[`shadow-${strategyId}-${symbol}`] = res.trades.length;
      all.push(...tag(`shadow-${strategyId}-${symbol}`, res.trades));
    }
  }

  console.log(`\n=== pooled trade count by stream ===`);
  console.table(perStreamCounts);
  console.log(`total pooled trades (all streams, doubtful fills dropped): ${all.length}`);

  const trainAll = all.filter((t) => nyMeta(t.entryTime).dateKey < splitDay);
  const valAll = all.filter((t) => nyMeta(t.entryTime).dateKey >= splitDay);
  console.log(`train n=${trainAll.length}, validation n=${valAll.length}`);

  function bucketBy<K extends string | number>(
    trades: TaggedTrade[],
    key: (t: TaggedTrade) => K
  ): Record<string, { n: number; net: number; expectancy: number; winRate: number }> {
    const m = new Map<K, TaggedTrade[]>();
    for (const t of trades) {
      const k = key(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    const out: Record<string, { n: number; net: number; expectancy: number; winRate: number }> = {};
    for (const [k, ts] of m.entries()) {
      const net = ts.reduce((s, t) => s + t.pnl, 0);
      const wins = ts.filter((t) => t.pnl > 0).length;
      out[String(k)] = { n: ts.length, net, expectancy: net / ts.length, winRate: (100 * wins) / ts.length };
    }
    return out;
  }

  function printBuckets(label: string, train: ReturnType<typeof bucketBy>, val: ReturnType<typeof bucketBy>) {
    console.log(`\n=== ${label}: TRAIN ===`);
    const keys = [...new Set([...Object.keys(train), ...Object.keys(val)])].sort();
    console.table(
      keys.map((k) => {
        const t = train[k];
        return t
          ? {
              bucket: k,
              n: t.n,
              flag: t.n < MIN_N ? "insufficient" : "",
              "win%": num(t.winRate, 1),
              net: `$${num(t.net, 0)}`,
              expectancy: `$${num(t.expectancy, 2)}`,
            }
          : { bucket: k, n: 0, flag: "no train trades", "win%": "—", net: "$0", expectancy: "—" };
      })
    );
    console.log(`\n=== ${label}: VALIDATION ===`);
    console.table(
      keys.map((k) => {
        const v = val[k];
        return v
          ? {
              bucket: k,
              n: v.n,
              flag: v.n < MIN_N ? "insufficient" : "",
              "win%": num(v.winRate, 1),
              net: `$${num(v.net, 0)}`,
              expectancy: `$${num(v.expectancy, 2)}`,
            }
          : { bucket: k, n: 0, flag: "no validation trades", "win%": "—", net: "$0", expectancy: "—" };
      })
    );

    // Refutation test: worst TRAIN bucket (n >= MIN_N), does dropping it help VALIDATION?
    const trainCandidates = Object.entries(train).filter(([, v]) => v.n >= MIN_N);
    if (!trainCandidates.length) {
      console.log(`no TRAIN bucket reaches n>=${MIN_N} — insufficient to test a restriction here.`);
      return;
    }
    const [worstKey, worstStats] = trainCandidates.sort((a, b) => a[1].expectancy - b[1].expectancy)[0];
    const valBaselineNet = Object.values(val).reduce((s, v) => s + v.net, 0);
    const valBaselineN = Object.values(val).reduce((s, v) => s + v.n, 0);
    const valWithoutWorst = Object.entries(val)
      .filter(([k]) => k !== worstKey)
      .reduce((acc, [, v]) => ({ net: acc.net + v.net, n: acc.n + v.n }), { net: 0, n: 0 });
    const worstInVal = val[worstKey];
    console.log(
      `worst TRAIN bucket: "${worstKey}" (n=${worstStats.n}, expectancy $${num(worstStats.expectancy, 2)}). ` +
        `VALIDATION for that same bucket: ${worstInVal ? `n=${worstInVal.n}, expectancy $${num(worstInVal.expectancy, 2)}` : "no trades"}.`
    );
    console.log(
      `VALIDATION combined expectancy WITH bucket: $${num(valBaselineN ? valBaselineNet / valBaselineN : 0, 2)} ` +
        `(n=${valBaselineN}) vs WITHOUT it: $${num(valWithoutWorst.n ? valWithoutWorst.net / valWithoutWorst.n : 0, 2)} ` +
        `(n=${valWithoutWorst.n}).`
    );
    const improved = worstInVal
      ? (valWithoutWorst.n ? valWithoutWorst.net / valWithoutWorst.n : 0) >
        (valBaselineN ? valBaselineNet / valBaselineN : 0)
      : null;
    if (improved === null)
      console.log(`VERDICT: insufficient — the worst TRAIN bucket had no VALIDATION trades to test against.`);
    else if (!improved || (worstInVal && worstInVal.expectancy > 0))
      console.log(
        `VERDICT: REFUTED for "${worstKey}" — ${
          worstInVal && worstInVal.expectancy > 0
            ? "the sign flipped positive on validation"
            : "dropping it did not improve validation expectancy"
        }.`
      );
    else console.log(`VERDICT: SURVIVED for "${worstKey}" — dropping it improved validation expectancy.`);
  }

  printBuckets(
    "combined, by NY hour-of-entry",
    bucketBy(trainAll, (t) => t.hour),
    bucketBy(valAll, (t) => t.hour)
  );
  printBuckets(
    "combined, by NY weekday",
    bucketBy(trainAll, (t) => t.weekday),
    bucketBy(valAll, (t) => t.weekday)
  );

  // Per-stream views, so a combined-pool bucket effect isn't mistaken for a
  // universal one if it's really just one strategy's known bad window.
  for (const streamName of [...new Set(all.map((t) => t.stream))]) {
    const streamTrades = all.filter((t) => t.stream === streamName);
    if (streamTrades.length < MIN_N * 2) continue; // too thin to bucket further, note and skip
    printBuckets(
      `${streamName}, by NY hour-of-entry`,
      bucketBy(
        streamTrades.filter((t) => nyMeta(t.entryTime).dateKey < splitDay),
        (t) => t.hour
      ),
      bucketBy(
        streamTrades.filter((t) => nyMeta(t.entryTime).dateKey >= splitDay),
        (t) => t.hour
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
