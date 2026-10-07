/* Simulated execution for the experimental learner. Pure: no clock, no I/O.

   One implementation serves both the real ledger and the one-contract shadow
   outcome every decision gets, so a skipped idea is judged by exactly the rules
   a taken one would have been.

   The rules, each pinned in tests/experiment-execution.test.ts:
   - Closed bars only. An order fills on the FIRST bar that starts at or after
     the decision time, at that bar's open plus slippage against us. A price
     that was already gone when the decision was made is never used.
   - Cancel instead of filling when the open is already through the stop or
     the target, when the stop ends up tighter than 2 points, or when the
     session's flatten time has come.
   - A bar that opens through the stop fills at the open (slipped), not at the
     stop price that never traded.
   - A bar that touches both stop and target is taken as the stop and marked
     ambiguous: one OHLC bar cannot say which came first, so the unfavourable
     path is assumed.
   - Targets are resting limit orders and fill at the target price.
   - Everything is flat by 15:25 New York time (earlier on early-close days).
     A trade whose flatten bar never arrived closes at the next bar's open and
     says so ("session-late").
   - No bar, no move: a missing bar never manufactures an exit. */

import type { Bar } from "@/lib/types";
import { flattenMinuteNy } from "@/lib/market/holidays";
import { nyTimeToUnix } from "@/lib/time/ny";
import { SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";
import { COMMISSION_RT, EXP_RISK, perContractRisk, pointValue, slipPoints } from "./policy";
import type { CancelReason, ExitReason, ExpSide, SimTrade } from "./types";

export const BAR_SEC = 300;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const direction = (side: ExpSide) => (side === "LONG" ? 1 : -1);

/** Unix seconds by which the trading day `sessionKey` must be flat. */
export function flattenAtSession(sessionKey: string): number {
  return nyTimeToUnix(sessionKey, flattenMinuteNy(sessionKey, SESSION_FLAT_MINUTE));
}

export function newSimTrade(fields: Pick<SimTrade, "symbol" | "side" | "qty" | "stop" | "target" | "decidedAt" | "sessionKey">): SimTrade {
  return {
    ...fields, status: "pending_fill", cancelReason: null, fillTs: null, fillPrice: null, entrySlip: null, risk: null,
    mark: null, markTs: null, stale: false, exitTs: null, exitPrice: null, exitSlip: null, exitReason: null,
    ambiguous: false, gross: null, fees: null, net: null,
  };
}

/** Dollar result of a trade at a price, commission included. */
export function valueAt(t: Pick<SimTrade, "side" | "fillPrice" | "qty" | "symbol">, price: number): number {
  if (t.fillPrice === null) return 0;
  return (price - t.fillPrice) * direction(t.side) * pointValue(t.symbol) * t.qty - COMMISSION_RT * t.qty;
}

/** Unrealized result of an open trade at its last mark (0 if never priced). */
export function unrealized(t: SimTrade): number {
  return t.status === "open" && t.mark !== null ? valueAt(t, t.mark) : 0;
}

function cancel(t: SimTrade, reason: CancelReason, at: number): SimTrade {
  return { ...t, status: "cancelled", cancelReason: reason, exitTs: at };
}

export function closeAt(t: SimTrade, rawPrice: number, slip: number, at: number, reason: ExitReason, ambiguous = false): SimTrade {
  const d = direction(t.side);
  const price = round4(rawPrice - d * slip);
  const gross = round2((price - (t.fillPrice ?? price)) * d * pointValue(t.symbol) * t.qty);
  const fees = round2(COMMISSION_RT * t.qty);
  return {
    ...t, status: "closed", exitTs: at, exitPrice: price, exitSlip: slip, exitReason: reason, ambiguous: t.ambiguous || ambiguous,
    mark: price, markTs: at, stale: false, gross, fees, net: round2(gross - fees),
  };
}

export interface FillOptions {
  /** Trim the quantity so the risk at the real fill stays inside this cap. */
  maxRisk?: number;
}

/** Try to fill a pending trade on `bar`. Returns the trade unchanged if the bar
    is before the decision; otherwise filled (and stepped through the same bar)
    or cancelled. */
export function fillEntry(t: SimTrade, bar: Bar, opts: FillOptions = {}): SimTrade {
  if (t.status !== "pending_fill" || bar.time < t.decidedAt) return t;
  const flatten = flattenAtSession(t.sessionKey);
  if (bar.time + BAR_SEC >= flatten) return cancel(t, "session-over", bar.time);
  const d = direction(t.side);
  const raw = bar.open;
  if (d > 0 ? raw <= t.stop : raw >= t.stop) return cancel(t, "stop-breached", bar.time);
  if (t.target !== null && (d > 0 ? raw >= t.target : raw <= t.target)) return cancel(t, "target-passed", bar.time);
  const slip = slipPoints(t.symbol, bar.time);
  const price = round4(raw + d * slip);
  if (Math.abs(price - t.stop) < EXP_RISK.minStopPoints || (d > 0 ? price <= t.stop : price >= t.stop)) return cancel(t, "stop-too-small", bar.time);
  const contractRisk = perContractRisk(t.symbol, price, t.stop, bar.time);
  let qty = t.qty;
  if (opts.maxRisk !== undefined) qty = Math.min(qty, Math.floor((opts.maxRisk + 1e-9) / contractRisk));
  if (qty <= 0) return cancel(t, "risk-budget", bar.time);
  const filled: SimTrade = {
    ...t, qty, status: "open", fillTs: bar.time, fillPrice: price, entrySlip: slip, risk: round2(contractRisk * qty),
    mark: price, markTs: bar.time, stale: false,
  };
  return stepOpen(filled, bar, true);
}

/** Advance an open trade through one closed bar. */
export function stepOpen(t: SimTrade, bar: Bar, isFillBar = false): SimTrade {
  if (t.status !== "open" || t.fillTs === null) return t;
  if (!isFillBar && bar.time <= t.fillTs) return t;
  if (t.markTs !== null && !isFillBar && bar.time + BAR_SEC <= t.markTs) return t;
  const d = direction(t.side);
  const flatten = flattenAtSession(t.sessionKey);
  const slip = slipPoints(t.symbol, bar.time);
  if (!isFillBar && bar.time >= flatten) return closeAt(t, bar.open, slip, bar.time, "session-late");
  if (!isFillBar && (d > 0 ? bar.open <= t.stop : bar.open >= t.stop)) return closeAt(t, bar.open, slip, bar.time, "stop");
  const stopHit = d > 0 ? bar.low <= t.stop : bar.high >= t.stop;
  const targetHit = t.target !== null && (d > 0 ? bar.high >= t.target : bar.low <= t.target);
  if (stopHit) return closeAt(t, t.stop, slip, bar.time + BAR_SEC, "stop", targetHit);
  if (targetHit) return closeAt(t, t.target!, 0, bar.time + BAR_SEC, "target");
  if (bar.time + BAR_SEC >= flatten) return closeAt(t, bar.close, slip, bar.time + BAR_SEC, "session");
  return { ...t, mark: bar.close, markTs: bar.time + BAR_SEC, stale: false };
}

/** Flatten at the last mark (used by the daily-loss and drawdown stops). */
export function forceClose(t: SimTrade, at: number, reason: ExitReason): SimTrade {
  if (t.status === "pending_fill") return cancel(t, "risk-budget", at);
  if (t.status !== "open" || t.mark === null) return t;
  return closeAt(t, t.mark, slipPoints(t.symbol, at), at, reason);
}

/** Step a trade through a run of closed bars of its own symbol. */
export function simulate(t: SimTrade, bars: Bar[], opts: FillOptions = {}): SimTrade {
  let cur = t;
  for (const bar of bars) {
    if (cur.status === "closed" || cur.status === "cancelled") break;
    cur = cur.status === "pending_fill" ? fillEntry(cur, bar, opts) : stepOpen(cur, bar);
  }
  return cur;
}
