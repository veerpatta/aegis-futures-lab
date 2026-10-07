/* The trial account: practice money that copies every trade idea.

   Why it exists. The practice account (scripts/engine/paper-broker.ts) only
   trades a method that has passed every test — and none has, so it has never
   placed a trade. The owner asked for a bot that actually runs money through
   its own rules today. This account does that without loosening the real gate:
   it copies EVERY idea the Ideas tab shows (visibleSignals), including ideas
   from methods that lost in testing, and labels itself "not proven" wherever
   it appears. It is a dress rehearsal for the plumbing — sizing, limits,
   marking, flattening — and an honest picture of what following the ideas
   would have done.

   What it shares with the practice account: the protective limits — the
   $10,000 start, the $400 daily loss limit and the $2,000 drawdown stop
   (lib/trial/policy.ts imports them from lib/paper/policy.ts). Each idea is
   taken at its own size, at most $160 of risk. What it does not share:
   anything that decides whether a method has earned the right to trade.
   Nothing here reads standing, the promotion gate or forward evidence, and
   nothing here can create a release.

   Exits mirror the idea. When an idea closes, the trial position closes at
   the idea's own exit price, so the two records agree to the cent per
   contract. Only when an idea the trial took later disappears from the Ideas
   tab (revised away, paused, stale) does the position manage itself on bars:
   stop, target, then the session's flatten time.

   This folder is outside the research-code hash on purpose: changing the trial
   must never restart the forward evidence of the methods under test. */

import type { Bar } from "@/lib/types";
import { TRIAL_RISK, sizeTrialTrade, type TrialSkipReason } from "./policy";
import { flattenMinuteNy } from "@/lib/market/holidays";
import { nyTimeToUnix, tradingDayKey } from "@/lib/time/ny";
import { SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";

export type { TrialSkipReason };
export type TrialSymbol = "MES" | "MNQ";
export type TrialSide = "LONG" | "SHORT";
const BAR_SEC = 300;

export interface TrialIdea {
  key: string;
  id: number | null;
  symbol: TrialSymbol;
  side: TrialSide;
  entry: number;
  stop: number;
  target: number | null;
  /** The idea's own size in contracts. */
  qty: number | null;
  /** Unix seconds. */
  signalTs: number;
  exitTs: number | null;
  exitPrice: number | null;
  status: string;
  /** On the Ideas tab right now (visibleSignals). */
  visible: boolean;
}

/** Why a position closed. Stable codes stored in the database; lib/plain/trial.ts has the words. */
export type TrialExitReason = "idea" | "stop" | "target" | "session" | "daily-loss" | "drawdown" | "round-end";

export interface TrialPosition {
  id: string;
  round: number;
  signalKey: string;
  signalId: number | null;
  symbol: TrialSymbol;
  side: TrialSide;
  qty: number;
  entry: number;
  stop: number;
  target: number | null;
  risk: number;
  mark: number;
  openedAt: number;
  lastMarkTs: number | null;
  closedAt: number | null;
  exitPrice: number | null;
  pnl: number | null;
  exitReason: TrialExitReason | null;
}

export interface TrialDecision {
  round: number;
  signalKey: string;
  taken: boolean;
  qty: number;
  reason: "taken" | TrialSkipReason;
}

export interface TrialAccount {
  round: number;
  /** Unix seconds; ideas before this belong to no round. */
  startedAt: number;
  equity: number;
  peak: number;
  dayKey: string;
  dayStartEquity: number;
  dailyPnl: number;
  openRisk: number;
  locked: boolean;
  lockedAt: number | null;
  /** Bar close up to which marks and limits have been applied. */
  lastEventTs: number | null;
}

export interface TrialCosts {
  pointValue: Record<TrialSymbol, number>;
  /** Round-trip commission per contract. */
  costPerContract: number;
  /** Slippage in points for one fill at this moment. */
  slip: (symbol: TrialSymbol, timeSec: number) => number;
}

export interface TrialStepInput {
  account: TrialAccount;
  /** Open positions of the current round. */
  open: TrialPosition[];
  /** Realized P&L of the round's closed positions. */
  realized: number;
  /** Signal keys this round has already decided. */
  decided: ReadonlySet<string>;
  ideas: TrialIdea[];
  bars: Partial<Record<TrialSymbol, Bar[]>>;
  nowSec: number;
  costs: TrialCosts;
}

export interface TrialStepResult {
  account: TrialAccount;
  opened: TrialPosition[];
  /** Positions whose mark moved or that closed this step (opened ones included). */
  changed: TrialPosition[];
  decisions: TrialDecision[];
}

/* An idea the trial may copy: it filled. "pending" waits for its entry price
   and "cancelled" never filled. */
const FILLED = new Set(["triggered", "hit_target", "hit_stop", "closed_win", "expired"]);

const direction = (side: TrialSide) => (side === "LONG" ? 1 : -1);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Dollar result of a position at a price, commission included. */
export function positionValue(p: Pick<TrialPosition, "side" | "entry" | "qty" | "symbol">, price: number, costs: TrialCosts): number {
  return (price - p.entry) * direction(p.side) * costs.pointValue[p.symbol] * p.qty - costs.costPerContract * p.qty;
}

/** Risk of one contract, the way the methods size their ideas: stop distance
    plus one exit's slippage, in dollars, plus the round-trip commission. */
export function perContractRisk(idea: Pick<TrialIdea, "symbol" | "entry" | "stop">, timeSec: number, costs: TrialCosts): number {
  const pv = costs.pointValue[idea.symbol];
  return (Math.abs(idea.entry - idea.stop) + costs.slip(idea.symbol, timeSec)) * pv + costs.costPerContract;
}

/** Unix seconds at which the trading day of `openedAt` must be flat. */
export function flattenAt(openedAt: number): number {
  const day = tradingDayKey(openedAt);
  return nyTimeToUnix(day, flattenMinuteNy(day, SESSION_FLAT_MINUTE));
}

export function stepTrial(input: TrialStepInput): TrialStepResult {
  const { costs, nowSec } = input;
  const account: TrialAccount = { ...input.account };
  const open = input.open.filter((p) => p.closedAt === null).map((p) => ({ ...p }));
  const changed = new Map<string, TrialPosition>();
  const opened: TrialPosition[] = [];
  const decisions: TrialDecision[] = [];
  const ideas = new Map(input.ideas.map((i) => [i.key, i]));
  let realized = input.realized;

  const bars: Partial<Record<TrialSymbol, Map<number, Bar>>> = {};
  const barTimes = new Set<number>();
  for (const symbol of ["MES", "MNQ"] as const) {
    const done = (input.bars[symbol] ?? []).filter((b) => b.time + BAR_SEC <= nowSec);
    bars[symbol] = new Map(done.map((b) => [b.time, b]));
    for (const b of done) barTimes.add(b.time);
  }

  const start = account.lastEventTs ?? account.startedAt;
  const candidates = input.ideas
    .filter((i) => i.visible && FILLED.has(i.status) && !input.decided.has(i.key) && i.signalTs >= account.startedAt && i.signalTs < nowSec &&
      Number.isFinite(i.entry) && Number.isFinite(i.stop))
    .sort((a, b) => a.signalTs - b.signalTs || a.key.localeCompare(b.key));

  const equityNow = () => TRIAL_RISK.capital + realized + open.reduce((a, p) => a + positionValue(p, p.mark, costs), 0);
  const openRisk = () => open.reduce((a, p) => a + p.risk, 0);

  const close = (p: TrialPosition, price: number, at: number, reason: TrialExitReason) => {
    p.exitPrice = price;
    p.mark = price;
    p.pnl = round2(positionValue(p, price, costs));
    p.closedAt = at;
    p.lastMarkTs = Math.max(p.lastMarkTs ?? at, at);
    p.exitReason = reason;
    realized += p.pnl;
    open.splice(open.indexOf(p), 1);
    changed.set(p.id, p);
  };

  const flattenAll = (time: number, reason: TrialExitReason) => {
    for (const p of [...open]) close(p, p.mark - direction(p.side) * costs.slip(p.symbol, time), time + BAR_SEC, reason);
  };

  const rollDay = (time: number) => {
    const day = tradingDayKey(time);
    if (day !== account.dayKey) {
      account.dayKey = day;
      account.dayStartEquity = equityNow();
    }
  };

  const enter = (idea: TrialIdea, time: number) => {
    const equity = equityNow();
    const sized = sizeTrialTrade(
      { equity, peak: Math.max(account.peak, equity), dailyPnl: equity - account.dayStartEquity, openRisk: openRisk(), locked: account.locked },
      perContractRisk(idea, time, costs),
      idea.qty,
    );
    if (!sized.qty) {
      decisions.push({ round: account.round, signalKey: idea.key, taken: false, qty: 0, reason: sized.reason ?? "risk-budget" });
      return;
    }
    const p: TrialPosition = {
      id: `${account.round}:${idea.key}`, round: account.round, signalKey: idea.key, signalId: idea.id,
      symbol: idea.symbol, side: idea.side, qty: sized.qty, entry: idea.entry, stop: idea.stop, target: idea.target,
      risk: round2(perContractRisk(idea, time, costs) * sized.qty), mark: idea.entry,
      openedAt: idea.signalTs, lastMarkTs: null, closedAt: null, exitPrice: null, pnl: null, exitReason: null,
    };
    open.push(p);
    opened.push(p);
    changed.set(p.id, p);
    decisions.push({ round: account.round, signalKey: idea.key, taken: true, qty: sized.qty, reason: "taken" });
  };

  const ideaExit = (p: TrialPosition, time: number) => {
    const idea = ideas.get(p.signalKey);
    if (!idea?.visible || idea.exitTs === null || idea.exitPrice === null || !Number.isFinite(idea.exitPrice) || idea.exitTs > time) return false;
    close(p, idea.exitPrice, Math.max(idea.exitTs, p.openedAt), "idea");
    return true;
  };

  /* An idea that closed mirrors its exit. One that left the Ideas tab manages
     itself on bars. One still open past its session's flatten time is
     flattened — the idea's own row is stale, not still trading. */
  const manage = (p: TrialPosition, time: number) => {
    if (ideaExit(p, time)) return;
    const bar = bars[p.symbol]?.get(time);
    if (!bar || time < p.openedAt || (p.lastMarkTs !== null && time + BAR_SEC <= p.lastMarkTs)) return;
    const d = direction(p.side);
    if (!ideas.get(p.signalKey)?.visible) {
      if (d > 0 ? bar.low <= p.stop : bar.high >= p.stop) {
        close(p, (d > 0 ? Math.min(bar.open, p.stop) : Math.max(bar.open, p.stop)) - d * costs.slip(p.symbol, time), time + BAR_SEC, "stop");
        return;
      }
      if (p.target !== null && (d > 0 ? bar.high >= p.target : bar.low <= p.target)) {
        close(p, p.target, time + BAR_SEC, "target");
        return;
      }
    }
    if (time + BAR_SEC > flattenAt(p.openedAt)) {
      close(p, bar.close - d * costs.slip(p.symbol, time), time + BAR_SEC, "session");
      return;
    }
    p.mark = bar.close;
    p.lastMarkTs = time + BAR_SEC;
    changed.set(p.id, p);
  };

  const applyLimits = (time: number) => {
    const equity = equityNow();
    account.peak = Math.max(account.peak, equity);
    if (!account.locked && account.peak - equity >= TRIAL_RISK.maxDrawdown) {
      account.locked = true;
      account.lockedAt = time + BAR_SEC;
      flattenAll(time, "drawdown");
    } else if (open.length && equity - account.dayStartEquity <= -TRIAL_RISK.dailyLoss) {
      flattenAll(time, "daily-loss");
    }
  };

  // Ideas the trial first sees after it has already moved past their time are
  // decided with the account as it stands now — at most one engine pass late.
  const late = candidates.filter((i) => i.signalTs < start);
  if (late.length) {
    rollDay(start);
    for (const idea of late) enter(idea, idea.signalTs);
  }

  const entriesAt = new Map<number, TrialIdea[]>();
  for (const idea of candidates) if (idea.signalTs >= start) entriesAt.set(idea.signalTs, [...(entriesAt.get(idea.signalTs) ?? []), idea]);
  const timeline = [...new Set([...[...barTimes].filter((t) => t >= start), ...entriesAt.keys()])].sort((a, b) => a - b);

  let lastEvent = account.lastEventTs;
  for (const time of timeline) {
    rollDay(time);
    for (const idea of entriesAt.get(time) ?? []) enter(idea, time);
    for (const p of [...open]) manage(p, time);
    if (barTimes.has(time)) {
      applyLimits(time);
      lastEvent = Math.max(lastEvent ?? 0, time + BAR_SEC);
    }
  }
  // Idea exits the bar timeline did not reach (no newer bar yet).
  for (const p of [...open]) ideaExit(p, nowSec);

  const equity = equityNow();
  if (!account.dayKey) {
    account.dayKey = tradingDayKey(nowSec);
    account.dayStartEquity = equity;
  }
  account.equity = round2(equity);
  account.peak = round2(Math.max(account.peak, equity));
  account.dailyPnl = round2(equity - account.dayStartEquity);
  account.openRisk = round2(openRisk());
  account.lastEventTs = lastEvent;
  return { account, opened, changed: [...changed.values()], decisions };
}
