/* A trade idea, read out in plain words.

   Every card and sheet that shows a signal row reads it through here, so the
   sentence, the dollar amounts and the honesty badge can never disagree
   between Today, Ideas and the detail sheet. */

import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { standingOf, type Standing } from "@/lib/strategies/registry";
import type { SignalRow } from "@/lib/neon/client";

/** Short market names a non-trader can place. */
export const MARKET_NAMES: Record<string, string> = {
  MES: "S&P micro",
  MNQ: "Nasdaq micro",
  MGC: "Gold micro",
  SI: "Silver",
};

export const marketName = (symbol: string): string => MARKET_NAMES[symbol] ?? symbol;

/** The strategy behind a row. Its dedupe_key is `${tier}:${strategyId}:${symbol}:${entry}`. */
export function strategyIdForRow(row: Pick<SignalRow, "dedupe_key">): string {
  return (row.dedupe_key ?? "").split(":")[1] ?? "";
}

export interface StandingBadge {
  label: string;
  tone: "red" | "amber" | "green";
  term: "refuted" | "untested" | "randomTest";
}

/* REFUTED is red and UNMEASURED amber on purpose (CLAUDE.md): "we looked and it
   is a coin flip" and "nobody has looked" are different claims. A measured
   method that cleared the bar would be green — none has, today. */
export function standingBadge(standing: Standing): StandingBadge {
  if (standing === "refuted") return { label: "Method hasn't beaten chance", tone: "red", term: "refuted" };
  if (standing === "unmeasured") return { label: "Method not tested yet", tone: "amber", term: "untested" };
  return { label: "Method passed the beat-random test", tone: "green", term: "randomTest" };
}

export function badgeForRow(row: Pick<SignalRow, "dedupe_key">): StandingBadge {
  return standingBadge(standingOf(strategyIdForRow(row)));
}

/** Points × point value, for one contract. Null for an unknown symbol. */
export function dollarsPerContract(symbol: string, points: number): number | null {
  const pv = POINT_VALUES[symbol as FeedSymbol];
  return pv === undefined ? null : Math.abs(points) * pv;
}

const price = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export interface IdeaPlain {
  /** "Buy" / "Sell". */
  side: string;
  /** "Exits at 30,810.01 if wrong (−$122 per contract) or 30,962.49 if right (+$183)." */
  exits: string;
  lossPerContract: number | null;
  gainPerContract: number | null;
}

export function ideaPlain(row: Pick<SignalRow, "symbol" | "direction" | "entry_price" | "stop_price" | "target_price">): IdeaPlain {
  const side = row.direction === "long" ? "Buy" : "Sell";
  const loss = dollarsPerContract(row.symbol, row.entry_price - row.stop_price);
  const gain = row.target_price === null ? null : dollarsPerContract(row.symbol, row.target_price - row.entry_price);
  const wrong = `${price(row.stop_price)} if wrong${loss === null ? "" : ` (−${usd(loss)} per contract)`}`;
  const exits =
    row.target_price === null
      ? `Exits at ${wrong}, or on its own exit signal.`
      : `Exits at ${wrong} or ${price(row.target_price)} if right${gain === null ? "" : ` (+${usd(gain)})`}.`;
  return { side, exits, lossPerContract: loss, gainPerContract: gain };
}

/** "Proved wrong if price falls below 29,798.68 — 37.3 points ($75 a contract) away." */
export function wrongIf(row: Pick<SignalRow, "symbol" | "direction" | "entry_price" | "stop_price">): string {
  const points = Math.abs(row.entry_price - row.stop_price);
  const dollars = dollarsPerContract(row.symbol, points);
  const way = row.direction === "long" ? "falls below" : "rises above";
  return `Proved wrong if price ${way} ${price(row.stop_price)} — ${points.toFixed(1)} points${
    dollars === null ? "" : ` (${usd(dollars)} a contract)`
  } away.`;
}

/** The scoring model's read in plain words; never invents a number. */
export function modelWords(winProb: number | null | undefined): string {
  if (winProb === null || winProb === undefined)
    return "Not scored: the bot's scoring model stays switched off until it predicts better than a simple guess.";
  return `The scoring model gives this about a ${Math.round(winProb * 100)}% chance to win.`;
}

/** How a finished or open idea ended, in words. */
export function outcomeWords(status: string, stale: boolean): string {
  if (stale) return "Not resolved yet";
  switch (status) {
    case "hit_target":
      return "Reached its target";
    case "hit_stop":
      return "Stopped out";
    case "closed_win":
      return "Closed with a gain";
    case "expired":
      return "Closed before stop or target";
    case "triggered":
      return "Open now";
    case "pending":
      return "Waiting for its entry price";
    case "cancelled":
      return "Cancelled before it started";
    default:
      return status;
  }
}

/** Running result of an open idea at the latest delayed price, per contract,
    after the round-trip commission — the same footing as a closed idea's result. */
export function runningPerContract(
  row: Pick<SignalRow, "symbol" | "direction" | "entry_price">,
  price: number,
  costPerContract: number,
): number | null {
  const pv = POINT_VALUES[row.symbol as FeedSymbol];
  if (pv === undefined || !Number.isFinite(price)) return null;
  return (price - row.entry_price) * (row.direction === "long" ? 1 : -1) * pv - costPerContract;
}

/** "Up $42 so far per contract, after costs" / "Down $18 …". */
export function runningWords(perContract: number, mask: (s: string) => string = (s) => s): string {
  return `${perContract >= 0 ? "Up" : "Down"} ${mask(usd(Math.abs(perContract)))} so far per contract, after costs`;
}
