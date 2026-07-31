/* Gross vs net, reported side by side.
 *
 * THE THING TO UNDERSTAND FIRST: gross is not "net plus the costs back". It is
 * a DIFFERENT BOOK. You cannot post-process a net trade list into a gross one,
 * because cost feeds back into which trades exist at all, through three
 * separate mechanisms:
 *
 *   1. Slippage moves the fill price, so |entry - stop| changes, so
 *      perContract changes, so qty = floor(maxRisk / perContract) can step.
 *   2. execution.cost is added to perContract directly (engine.ts:218), same
 *      floor, same effect.
 *   3. For a netDollar target, cost moves the TARGET PRICE itself
 *      (engine.ts:238: targetPoints = (amount + cost*qty) / (point*qty)).
 *      zone-v5 emits netDollar targets, so tier A's gross run genuinely aims
 *      at a different level, not merely fills at a different one.
 *
 * And the engine holds one position at a time (engine.ts:326). So the moment
 * one trade's exit time differs, the set of signals that are even reachable
 * afterwards differs too. Divergence cascades; it does not stay local.
 *
 * Hence: two runs, and an honest report about where they parted company.
 * Friction attribution is quoted ONLY over the matched prefix, where it
 * reconciles to the cent. Everything after first divergence is labelled as
 * what it is — a different book — and never folded into a cost figure.
 *
 * Corollary worth stating because it looks like a bug: net > gross is
 * possible. A costlier run can skip a trade that would have lost, or size
 * down into a loser. That is a real result, not an error.
 */

import type { Trade } from "@/lib/types";
import type { BacktestResult } from "./engine";
import type { RunRequest } from "./run";
import { frictionDollarsPerContract, roundTripCost, type CostModel } from "@/lib/costs";

export type Runner = (req: RunRequest) => BacktestResult | Promise<BacktestResult>;

/** Identity of a trade for matching one book against the other. */
export interface TradeKey {
  symbol: string;
  side: "LONG" | "SHORT";
  entryTime: number;
}

const keyOf = (t: Trade): string => `${t.symbol}|${t.side}|${t.entryTime}`;
const keyParts = (t: Trade): TradeKey => ({
  symbol: t.symbol,
  side: t.side,
  entryTime: t.entryTime,
});

export interface Divergence {
  /** Entry time of the first trade the two books disagree about. */
  firstDivergenceTime: number | null;
  /** Trades that matched (same key AND same qty) before that point. */
  matchedBeforeDivergence: number;
  /** Share of the larger book that sits at or after first divergence. */
  tradesAfterDivergenceFraction: number;
  grossOnly: TradeKey[];
  netOnly: TradeKey[];
  qtyDiffs: { key: TradeKey; grossQty: number; netQty: number }[];
  /* Trades present in BOTH books by (symbol, side, entryTime), ignoring size.
     This is the number that matters when costs change position size but not
     which signals fire: matchedBeforeDivergence stops at the first qty step
     and would report 0 for two books that took identical trades throughout. */
  sameKeyCount: number;
  /* Modelled friction over the WHOLE net book, in dollars. With risk-based
     sizing qty is often much greater than 1, so this is the figure to quote
     when asking "how much of the loss is cost" — a per-contract number
     understates it by the average contract count. */
  frictionOnNetBook: number;
  /** Mean contracts per trade in the net book. */
  meanNetQty: number;
  /* The RANGE matters, not just the mean. If qty is pinned at a ceiling the
     engine is sizing to the risk cap on every trade, and friction then scales
     linearly with contract count while any edge does not — which reframes a
     loss from "no edge" to "an edge too small to survive N× friction". If qty
     varies, sizing is genuinely per-trade off the stop distance. */
  minNetQty: number;
  maxNetQty: number;
  /** Nominal modelled friction (commission + slippage dollars) on the matched prefix. */
  frictionOnMatched: number;
  /** Commission alone on the matched prefix. Exact: it never touches a price. */
  commissionOnMatched: number;
  /** net − gross over the matched prefix. Measured, not modelled. */
  deltaMatched: number;
  /* The part of deltaMatched that commission does NOT explain.
     This is NOT "slippage in dollars" and must not be labelled as such.
     Entry slippage moves the fill price, which moves |entry − stop|, which
     moves an rMultiple target proportionally — so a slipped trade travels
     FURTHER to its target and books more gross points. The residual is the
     net of paying the spread and having the trade geometry stretched, and it
     is routinely smaller than the nominal slippage charge. */
  geometryEffect: number;
  /** Whole-book (net − gross) minus deltaMatched: the "different trades" part. */
  pathEffect: number;
  /* True when commission alone accounts for the matched prefix to within a
     cent — which is the case exactly when slippage is zero and no netDollar
     target is in play. With slippage on, expect false; that is not an error,
     it is geometryEffect being non-zero. */
  reconciles: boolean;
}

export interface GrossNetReport {
  gross: BacktestResult;
  net: BacktestResult;
  divergence: Divergence;
  /** Convenience headline figures. */
  grossNetTotal: number;
  netNetTotal: number;
  /** Per-trade expectancy of each book. */
  grossPerTrade: number | null;
  netPerTrade: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);

/* Compare two books. Pure — no runner, no I/O, so it is directly testable. */
export function compareBooks(
  gross: BacktestResult,
  net: BacktestResult,
  costModel: CostModel,
): Divergence {
  const g = gross.trades;
  const n = net.trades;

  // Walk both books in lockstep until the first disagreement. Trades are
  // already in entry-time order within a run.
  let i = 0;
  while (i < g.length && i < n.length && keyOf(g[i]) === keyOf(n[i]) && g[i].qty === n[i].qty) i++;
  const matched = i;
  const firstDivergenceTime =
    matched < Math.max(g.length, n.length)
      ? (g[matched]?.entryTime ?? n[matched]?.entryTime ?? null)
      : null;

  const grossKeys = new Set(g.map(keyOf));
  const netKeys = new Set(n.map(keyOf));
  const grossOnly = g.filter((t) => !netKeys.has(keyOf(t))).map(keyParts);
  const netOnly = n.filter((t) => !grossKeys.has(keyOf(t))).map(keyParts);

  const netByKey = new Map(n.map((t) => [keyOf(t), t]));
  const qtyDiffs = g
    .map((t) => ({ t, m: netByKey.get(keyOf(t)) }))
    .filter((p): p is { t: Trade; m: Trade } => !!p.m && p.m.qty !== p.t.qty)
    .map(({ t, m }) => ({ key: keyParts(t), grossQty: t.qty, netQty: m.qty }));

  // Friction over the matched prefix only, where "the same trade" is meaningful.
  const matchedNet = n.slice(0, matched);
  const frictionOnMatched = sum(
    matchedNet.map((t) => frictionDollarsPerContract(costModel, t.symbol) * t.qty),
  );
  const commissionOnMatched = sum(matchedNet.map((t) => roundTripCost(costModel) * t.qty));
  const deltaMatched = sum(matchedNet.map((t) => t.pnl)) - sum(g.slice(0, matched).map((t) => t.pnl));
  const wholeBookDelta = sum(n.map((t) => t.pnl)) - sum(g.map((t) => t.pnl));

  const longest = Math.max(g.length, n.length);
  return {
    firstDivergenceTime,
    matchedBeforeDivergence: matched,
    tradesAfterDivergenceFraction: longest ? (longest - matched) / longest : 0,
    grossOnly,
    netOnly,
    qtyDiffs,
    sameKeyCount: g.filter((t) => netKeys.has(keyOf(t))).length,
    frictionOnNetBook: sum(
      n.map((t) => frictionDollarsPerContract(costModel, t.symbol) * t.qty),
    ),
    meanNetQty: n.length ? sum(n.map((t) => t.qty)) / n.length : 0,
    minNetQty: n.length ? Math.min(...n.map((t) => t.qty)) : 0,
    maxNetQty: n.length ? Math.max(...n.map((t) => t.qty)) : 0,
    frictionOnMatched,
    commissionOnMatched,
    deltaMatched,
    geometryEffect: deltaMatched + commissionOnMatched,
    pathEffect: wholeBookDelta - deltaMatched,
    // To the cent, not to floating-point epsilon — these are dollars.
    reconciles: Math.abs(deltaMatched + commissionOnMatched) < 0.01,
  };
}

/* Build the zero-cost twin of a request.
   Everything except cost and slippage is carried across untouched — that
   invariant is what makes the comparison mean anything, and it is asserted
   in tests/gross-net.test.ts. */
export function grossRequestFrom(req: RunRequest): RunRequest {
  return { ...req, execution: { ...req.execution, cost: 0, slippage: 0 } };
}

/* Run both books. The runner is injected so this one module serves the Node
   scripts (executeRun) and the browser Lab (the worker client) without
   dragging "use client" into scripts/. */
export async function runGrossNet(
  req: RunRequest,
  run: Runner,
  costModel: CostModel,
): Promise<GrossNetReport> {
  const net = await run(req);
  const gross = await run(grossRequestFrom(req));
  const divergence = compareBooks(gross, net, costModel);
  const grossTotal = sum(gross.trades.map((t) => t.pnl));
  const netTotal = sum(net.trades.map((t) => t.pnl));
  return {
    gross,
    net,
    divergence,
    grossNetTotal: grossTotal,
    netNetTotal: netTotal,
    grossPerTrade: gross.trades.length ? grossTotal / gross.trades.length : null,
    netPerTrade: net.trades.length ? netTotal / net.trades.length : null,
  };
}

/* One-line summary for scripts and UI copy. Deliberately refuses to print a
   single "cost drag" number when the books diverged early, because at that
   point there is no such quantity. */
export function describeDivergence(d: Divergence): string {
  if (d.firstDivergenceTime === null) {
    return `Books are identical in shape (${d.matchedBeforeDivergence} trades); the whole difference is cost.`;
  }
  const pct = (d.tradesAfterDivergenceFraction * 100).toFixed(1);
  return (
    `Books part company after ${d.matchedBeforeDivergence} matched trades ` +
    `(${pct}% of the book follows). Cost attribution is quoted over the matched ` +
    `prefix only; the rest is a different set of trades, not a cost difference.`
  );
}
