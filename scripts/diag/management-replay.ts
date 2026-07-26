/* Weekly research — Hypothesis 1: EXIT AND MANAGEMENT REPLAY.

   WHAT IT ASKS
   ────────────
   The live tier streams use a fixed target (2R for zone-v5, 1.5R for
   rsi-reversion) plus a hard session-close flatten at 15:25 ET. Does any
   alternative exit rule — breakeven-after-1R, ATR trailing, a time stop,
   partial-at-1R with a runner, or moving the flatten minute — improve PF
   net of costs on data we already have?

   HYPOTHESIS (falsifiable)
   ─────────────────────────
   H1: "An alternative management rule improves PF/expectancy over the live
   exit, and the improvement holds on held-out (validation) trades, not just
   on the trades used to pick it."

   WHAT WOULD REFUTE IT
   ─────────────────────
   Pick whichever variant has the best PF on the TRAIN slice (first ~70% of
   sessions by date). If that same variant does not beat the live baseline's
   PF on the VALIDATION slice (the remaining ~30%, held out), H1 is refuted —
   the train-set win was noise, not a rule worth adopting. Report every
   variant's numbers on both slices regardless of which one "wins" on train.

   METHOD
   ──────
   Entries are NOT re-derived — this is a replay, not a re-run. Each tier
   stream's live-config trades are produced once (identical to
   tier-a-baseline.ts / tiers.ts), then for each trade the bars AFTER entry
   are re-walked under each alternative management rule, holding entry price,
   stop, side, qty and symbol fixed. Baseline replay is checked against the
   engine's own recorded trades as a correctness sanity check (see below).
   Costs: same $2.40/contract as EXECUTION.cost; slippage columns model an
   EXTRA per-trade round-trip cost of (2x-1x) or (3x-1x) times
   EXECUTION.slippage, deducted from every trade regardless of exit reason —
   an approximation (the live engine only prices slippage into entries), not
   a re-simulation of fills, and is documented here so it isn't mistaken for
   the latter.
   Doubtful fills (tier A resting-limit trades never revisited after a
   touch-only entry) are dropped before any table is built, per the standing
   method rule.
   p95 drawdown is a 500-shuffle bootstrap of trade order (path dependence:
   the realized order is one draw, not the worst case) — see p95Drawdown in
   archive-lib.ts.

   REPRODUCE
   ─────────
     npx tsx scripts/diag/management-replay.ts
   Read-only: no writes, no parameter changes to scripts/engine/tiers.ts. */

import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { auditFill } from "@/scripts/engine/fill-audit";
import { nyMeta } from "@/lib/time/ny";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "@/scripts/engine/tiers";
import { archiveBars, num, p95Drawdown, profitFactor, sessionsIn, winRate, atrAt } from "./archive-lib";

const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const TRAIN_FRACTION = 0.7;

interface BaseTrade {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  stop: number;
  target: number | null;
  entryTime: number;
  entryIdx: number;
  recordedPnl: number;
  recordedExitReason: string;
  /* limit fills (tier A) can resolve on the ENTRY bar itself — the engine's
     "swept same bar" convention (lib/backtest/engine.ts) closes at the
     original stop before any management logic ever runs. nextOpen fills
     (tier B) never do: the fill bar is never checked for stop/target. */
  fillModel: "limit" | "nextOpen";
}

interface Variant {
  id: string;
  label: string;
  sessionExitMinute?: number;
  breakeven?: boolean;
  trailAtrMult?: number;
  timeStopBars?: number;
  partial?: boolean;
}

const VARIANTS: Variant[] = [
  { id: "baseline", label: "Live: fixed target, flat 15:25" },
  { id: "breakeven1R", label: "Stop to breakeven after 1R", breakeven: true },
  { id: "atrTrail2x", label: "ATR(14) x2 trailing stop", trailAtrMult: 2 },
  { id: "atrTrail3x", label: "ATR(14) x3 trailing stop", trailAtrMult: 3 },
  { id: "timeStop12", label: "Time stop @ 12 bars (60m)", timeStopBars: 12 },
  { id: "timeStop24", label: "Time stop @ 24 bars (2h)", timeStopBars: 24 },
  { id: "partial1R", label: "Partial 50% @ 1R, runner to target", partial: true },
  { id: "close1500", label: "Flat @ 15:00 ET (tighter)", sessionExitMinute: 900 },
  { id: "close1600", label: "Flat @ 16:00 ET (looser)", sessionExitMinute: 960 },
];

interface ManagedResult {
  pnl: number;
  exitReason: string;
  legs: { pnl: number }[]; // >1 leg only for the partial variant
}

/* Re-walk the bars AFTER entry under one management variant. Mirrors the
   engine's own stop-first-same-bar convention (lib/backtest/engine.ts) so a
   baseline replay should reproduce the recorded trade almost exactly. */
function manageTrade(t: BaseTrade, bars: Bar[], v: Variant, cost: number): ManagedResult {
  const point = POINT_VALUES[t.symbol as FeedSymbol];
  const rDistance = Math.abs(t.entry - t.stop);
  const long = t.side === "LONG";
  let stop = t.stop;
  const flatMinute = v.sessionExitMinute ?? SESSION_EXIT_MINUTE;
  const entryDay = nyMeta(t.entryTime).dateKey;
  let remainingQty = t.qty;
  let partialDone = false;
  let realized = 0;
  const legs: { pnl: number }[] = [];
  const closeAt = (price: number, qty: number, reason: string): ManagedResult => {
    const points = long ? price - t.entry : t.entry - price;
    const pnl = points * point * qty - cost * qty;
    legs.push({ pnl });
    realized += pnl;
    return { pnl: realized, exitReason: reason, legs };
  };

  // Limit-fill "swept same bar": the resting order and the original stop can
  // both trade on the touch bar. The engine treats this as a same-bar
  // stop-out, unconditionally, BEFORE any management (adjustStop never runs
  // on the fill bar) — reproduce that exactly, ignoring the variant.
  if (t.fillModel === "limit") {
    const entryBar = bars[t.entryIdx];
    const swept = long ? entryBar.low <= t.stop : entryBar.high >= t.stop;
    if (swept) return closeAt(t.stop, t.qty, "stop");
  }

  for (let i = t.entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    if (nyMeta(b.time).dateKey !== entryDay) break; // same-session only, matches live discipline
    const barsHeld = i - t.entryIdx;
    const favorable = long ? b.high - t.entry : t.entry - b.low;

    if (v.breakeven && (long ? stop < t.entry : stop > t.entry) && favorable >= rDistance)
      stop = t.entry;

    if (v.trailAtrMult) {
      const atr = atrAt(bars, i, 14);
      const trail = long ? b.close - v.trailAtrMult * atr : b.close + v.trailAtrMult * atr;
      if (long ? trail > stop : trail < stop) stop = trail;
    }

    if (v.partial && !partialDone && favorable >= rDistance) {
      const partialQty = Math.max(1, Math.floor(t.qty / 2));
      const exitPrice = long ? t.entry + rDistance : t.entry - rDistance;
      const points = long ? exitPrice - t.entry : t.entry - exitPrice;
      const pnl = points * point * partialQty - cost * partialQty;
      legs.push({ pnl });
      realized += pnl;
      remainingQty = t.qty - partialQty;
      stop = t.entry; // breakeven on the runner
      partialDone = true;
      if (remainingQty <= 0) return { pnl: realized, exitReason: "partial-all", legs };
    }

    const qtyLeft = v.partial && partialDone ? remainingQty : t.qty;
    const stopHit = long ? b.low <= stop : b.high >= stop;
    const targetHit = t.target !== null && (long ? b.high >= t.target : b.low <= t.target);
    if (stopHit) return closeAt(stop, qtyLeft, "stop");
    if (targetHit) return closeAt(t.target as number, qtyLeft, "target");
    if (v.timeStopBars && barsHeld >= v.timeStopBars) return closeAt(b.close, qtyLeft, "timeStop");
    if (nyMeta(b.time).minutes >= flatMinute) return closeAt(b.close, qtyLeft, "session");
  }
  // Ran off the end of the archive/day without resolving — close at the last bar seen.
  const last = bars[bars.length - 1];
  const qtyLeft = v.partial && partialDone ? remainingQty : t.qty;
  return closeAt(last.close, qtyLeft, "windowEnd");
}

function buildBaseTrades(
  streamId: string,
  full: Record<string, Bar[]>,
  indexOf: Record<string, Map<number, number>>
): { trades: BaseTrade[]; fillModel: "limit" | "nextOpen"; label: string; droppedDoubtful: number } {
  const stream = tierStreams().find((s) => (s.tier === "A" ? "A" : `B:${s.symbols.join("+")}`) === streamId);
  if (!stream) throw new Error(`unknown stream ${streamId}`);
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

  const trades: BaseTrade[] = [];
  let droppedDoubtful = 0;
  for (const t of res.trades) {
    if (stream.fillModel === "limit") {
      const conf = auditFill({
        fillModel: "limit",
        direction: t.side === "LONG" ? "long" : "short",
        limit: t.entryPrice, // proximal ≈ recorded entry minus/plus slippage; adequate for a doubtful-fill screen
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        bars: full[t.symbol],
      });
      if (conf === "doubtful") {
        droppedDoubtful++;
        continue;
      }
    }
    const idx = indexOf[t.symbol].get(t.entryTime);
    if (idx === undefined) continue; // shouldn't happen — entry times come from these same bars
    trades.push({
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      entry: t.entryPrice,
      stop: t.stop,
      target: t.target,
      entryTime: t.entryTime,
      entryIdx: idx,
      recordedPnl: t.pnl,
      recordedExitReason: t.exitReason,
      fillModel: stream.fillModel,
    });
  }
  return { trades, fillModel: stream.fillModel, label: `${streamId} (${stream.label})`, droppedDoubtful };
}

function report(
  label: string,
  trades: BaseTrade[],
  full: Record<string, Bar[]>,
  extraSlipMult: 0 | 1 | 2
) {
  // extraSlipMult 0/1/2 = +0x, +1x (→2x total), +2x (→3x total) EXECUTION.slippage
  const rows = VARIANTS.map((v) => {
    const pnls: number[] = [];
    for (const t of trades) {
      const bars = full[t.symbol];
      const managed = manageTrade(t, bars, v, EXECUTION.cost);
      const extraSlip = extraSlipMult * EXECUTION.slippage * POINT_VALUES[t.symbol as FeedSymbol] * t.qty;
      pnls.push(managed.pnl - extraSlip);
    }
    const net = pnls.reduce((s, p) => s + p, 0);
    return {
      variant: v.label,
      trades: pnls.length,
      "win%": num(winRate(pnls), 1),
      PF: num(profitFactor(pnls)),
      net: `$${num(net, 0)}`,
      "p95 DD": `$${num(p95Drawdown(pnls), 0)}`,
    };
  });
  console.log(`\n=== ${label} — n=${trades.length} — slippage x${1 + extraSlipMult} ===`);
  console.table(rows);
}

async function main() {
  const full: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) full[s] = await archiveBars(s);
  const indexOf: Record<string, Map<number, number>> = {};
  for (const s of SYMBOLS) {
    const m = new Map<number, number>();
    full[s].forEach((b, i) => m.set(b.time, i));
    indexOf[s] = m;
  }

  const streamIds = ["A", "B:MES", "B:MNQ"];
  for (const streamId of streamIds) {
    const { trades, droppedDoubtful, label } = buildBaseTrades(streamId, full, indexOf);
    console.log(
      `\n\n############ ${label} — ${trades.length} trades kept, ${droppedDoubtful} doubtful-fill dropped ############`
    );
    if (trades.length < 5) {
      console.log("insufficient trades for a management sweep — skipping");
      continue;
    }

    // Baseline sanity check: replay under the "baseline" variant should closely
    // match the engine's own recorded pnl (small differences are acceptable —
    // the replay does not model the swept-same-bar special case for limit
    // fills, since those never enter this table's population).
    const baselineReplayPnl = trades.reduce(
      (s, t) => s + manageTrade(t, full[t.symbol], VARIANTS[0], EXECUTION.cost).pnl,
      0
    );
    const recordedPnl = trades.reduce((s, t) => s + t.recordedPnl, 0);
    console.log(
      `sanity check — replayed baseline net $${num(baselineReplayPnl, 0)} vs recorded $${num(recordedPnl, 0)} ` +
        `(diff $${num(baselineReplayPnl - recordedPnl, 0)})`
    );

    const byDay = [...new Set(trades.map((t) => nyMeta(t.entryTime).dateKey))].sort();
    const splitDay = byDay[Math.floor(byDay.length * TRAIN_FRACTION)];
    const trainTrades = trades.filter((t) => nyMeta(t.entryTime).dateKey < splitDay);
    const valTrades = trades.filter((t) => nyMeta(t.entryTime).dateKey >= splitDay);
    console.log(
      `train/validation split at ${splitDay}: ${trainTrades.length} train trades ` +
        `(${byDay.filter((d) => d < splitDay).length} sessions), ${valTrades.length} validation trades ` +
        `(${byDay.filter((d) => d >= splitDay).length} sessions)`
    );
    if (trainTrades.length < 5 || valTrades.length < 5) {
      console.log("insufficient n on one side of the split for a train/validation comparison");
    }

    report(`${label} — TRAIN slice`, trainTrades, full, 0);
    report(`${label} — VALIDATION slice`, valTrades, full, 0);
    report(`${label} — VALIDATION slice @ 2x slippage`, valTrades, full, 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
