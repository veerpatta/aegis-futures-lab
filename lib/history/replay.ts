/* Historical replay. Pure: bars in, examples out — no clock, no I/O.

   One causal pass per (symbol, month):
   1. Ideas: the live engine's frozen tier streams (scripts/engine/tiers.ts,
      unchanged parameters, refuted methods kept as frozen controls) run over
      the month plus the same 60 days of warm-up the live engine sees. Only
      ideas whose entry falls inside the month belong to the chunk.
   2. Decide: each idea goes through the learner's own batch code
      (lib/experiment/step.ts stepTick) at its modeled decision time, seeing
      only bars that had closed by then — features, structural checks and the
      take-every-idea control exactly as live.
   3. Fill and label: the one-contract outcome steps forward on later bars with
      the learner's execution rules (next bar after the decision, both-side
      costs, gap fills, stop-first on ambiguous bars, session flattening). A
      label is released only when its exit exists in the data.

   Each idea is decided with a fresh account, so this records the decision
   rules, not portfolio interactions; those are measured separately by the
   study's portfolio simulation under identical risk limits. */

import type { Bar, Trade } from "@/lib/types";
import type { OpenPosition } from "@/lib/strategies/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES } from "@/lib/market/contracts";
import { MARKET_HOLIDAYS, flattenMinuteNy } from "@/lib/market/holidays";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import { computeRegime } from "@/scripts/engine/regime";
import { vixBucketFor } from "@/scripts/engine/context";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "@/scripts/engine/tiers";
import { stepTick } from "@/lib/experiment/step";
import { simulate } from "@/lib/experiment/execution";
import { TAKE_ALL_V1 } from "@/lib/experiment/models";
import { pointValue } from "@/lib/experiment/policy";
import type { FrozenFeatures, Opportunity } from "@/lib/experiment/types";
import { HIST_RULES } from "./rules";
import { touchesFlag, type FlaggedWindow } from "./quality";

export type ReplayMode = "observation" | "strategy";

export interface ContextRowLike {
  date_key: string;
  vix: number | null;
  dxy: number | null;
  tnx: number | null;
}

export interface ReplayExample {
  mode: ReplayMode;
  familyId: string;
  month: string;
  symbol: "MES" | "MNQ";
  side: "LONG" | "SHORT";
  strategy: string;
  tier: string;
  signalTs: number;
  seenAt: number;
  decidedAt: number;
  infoCutoff: number;
  labelReadyAt: number | null;
  features: FrozenFeatures | null;
  reason: string;
  outcomeStatus: "closed" | "void" | "open";
  voidReason: string | null;
  standaloneQty: number;
  fillTs: number | null;
  fillPrice: number | null;
  exitTs: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  ambiguous: boolean;
  grossPc: number | null;
  feesPc: number | null;
  slipPc: number | null;
  netPc: number | null;
  riskPc: number | null;
  quality: string[];
  quarantined: boolean;
  snapshotHash: string;
  ideaExitTs: number | null;
}

const BAR = 300;
const DAY = 86400;

const EXIT_MINUTE_BY_DAY: Record<string, number> = Object.fromEntries(
  MARKET_HOLIDAYS.filter((h) => h.kind === "early-close").map((h) => [h.date, flattenMinuteNy(h.date, SESSION_EXIT_MINUTE)]),
);

/** Month bounds in unix seconds (UTC calendar month). */
export function monthBounds(month: string): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number);
  return { start: Date.UTC(y, m - 1, 1) / 1000, end: Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) / 1000 };
}

/** The frozen tier streams' ideas for one symbol, entries inside [start, end). */
export function streamIdeas(bars: Bar[], symbol: "MES" | "MNQ", start: number, end: number, ctx: ContextRowLike[]): Opportunity[] {
  const out: Opportunity[] = [];
  if (!bars.some((b) => b.time >= start && b.time < end)) return out; // an empty month has no ideas; the chunk report shows 0 bars
  for (const stream of tierStreams()) {
    if (!stream.symbols.includes(symbol)) continue;
    const res = executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series: { [symbol]: bars },
      execution: { ...EXECUTION, fillModel: stream.fillModel, maxRisk: stream.maxRisk ?? EXECUTION.maxRisk },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      sessionExitMinuteByDay: EXIT_MINUTE_BY_DAY,
      pointValues: POINT_VALUES,
      keepOpenAtEnd: true,
    });
    const tag = stream.dedupeTag ?? stream.label;
    const make = (o: { side: "LONG" | "SHORT"; entry: number; stop: number; target: number | null; entryTime: number; exitTime: number | null; score?: number }): Opportunity => {
      const stopDist = Math.abs(o.entry - o.stop);
      return {
        key: `${stream.tier}:${tag}:${symbol}:${o.entryTime}`, signalId: null, symbol, side: o.side, entry: o.entry, stop: o.stop, target: o.target,
        signalTs: o.entryTime, seenAt: o.entryTime + BAR, exitTs: o.exitTime, strategy: stream.label, tier: stream.tier,
        regime: computeRegime(bars, o.entryTime), vixBucket: vixBucketFor(ctx, nyMeta(o.entryTime).dateKey),
        score: o.score ?? null, rr: o.target !== null && stopDist > 0 ? +(Math.abs(o.target - o.entry) / stopDist).toFixed(2) : null,
      };
    };
    for (const t of res.trades as Trade[]) {
      if (t.entryTime < start || t.entryTime >= end) continue;
      out.push(make({ side: t.side, entry: t.entryPrice, stop: t.stop, target: t.target, entryTime: t.entryTime, exitTime: t.exitReason === "windowEnd" ? null : t.exitTime, score: t.score }));
    }
    const p = res.openPosition as OpenPosition | null;
    if (p && p.openedAt >= start && p.openedAt < end)
      out.push(make({ side: p.side, entry: p.entry, stop: p.stop, target: p.target, entryTime: p.openedAt, exitTime: null, score: p.score }));
  }
  return out.sort((a, b) => a.signalTs - b.signalTs || a.key.localeCompare(b.key));
}

/** First learner check (UTC minute in tickMinutes) at or after `t`. */
export function nextTick(t: number, minutes = HIST_RULES.tickMinutes): number {
  let c = Math.ceil(t / 60) * 60;
  for (let i = 0; i < 24 * 60; i++, c += 60) if (minutes.includes(new Date(c * 1000).getUTCMinutes())) return c;
  return c;
}

export function decisionTime(op: Opportunity, mode: ReplayMode, lagSec: number): { seenAt: number; decidedAt: number } {
  if (mode === "strategy") return { seenAt: op.signalTs + BAR, decidedAt: op.signalTs + BAR };
  const seenAt = op.signalTs + Math.max(BAR, lagSec);
  return { seenAt, decidedAt: nextTick(seenAt) };
}

/** Decide one idea at its modeled time with the learner's own code, then label it. */
export function replayIdea(op: Opportunity, bars: Bar[], mode: ReplayMode, lagSec: number, month: string, flags: FlaggedWindow[], rules = HIST_RULES): ReplayExample {
  const { seenAt, decidedAt } = decisionTime(op, mode, lagSec);
  const visible: Opportunity = { ...op, seenAt };
  const known = bars.filter((b) => b.time + BAR <= decidedAt && b.time >= decidedAt - 3 * DAY);
  const r = stepTick({
    exp: { id: "hist", lineage: "hist", campaign: 1, mode: "live", status: "active", capital: 10000, startedAt: decidedAt - 60, seed: rules.seed },
    account: {
      equity: 10000, realized: 0, unrealized: 0, unpricedPositions: 0, peak: 10000, dayKey: "", dayStartEquity: 10000, dailyPnl: 0, openRisk: 0,
      dayHalted: false, lockedAt: null, cursor: { MES: decidedAt, MNQ: decidedAt }, staleSymbols: [], lastOkTickAt: null,
    },
    positions: [], outcomes: [], bars: { [op.symbol]: known }, opportunities: [visible],
    model: { versionId: "hist:v1-take-all", artifact: TAKE_ALL_V1 }, challengers: [], nowSec: decidedAt, provenance: "replay", quota: "normal",
  });
  const d = r.decisions[0];
  const o = r.outcomes[0];
  let sim = o.sim;
  let outcomeStatus: ReplayExample["outcomeStatus"] = o.status === "void" ? "void" : "open";
  let voidReason = o.voidReason;
  if (o.status !== "void") {
    sim = simulate(o.sim, bars.filter((b) => b.time >= decidedAt));
    if (sim.status === "closed") outcomeStatus = "closed";
    else if (sim.status === "cancelled") { outcomeStatus = "void"; voidReason = sim.cancelReason; }
  }
  const closed = outcomeStatus === "closed";
  const flag = touchesFlag(flags, op.signalTs - rules.quality.quarantineLeadSec, closed ? sim.exitTs! : decidedAt + DAY);
  const quality = flag ? [`${flag.kind}: ${flag.detail}`] : [];
  return {
    mode, familyId: op.key, month, symbol: op.symbol, side: op.side, strategy: op.strategy, tier: op.tier ?? "",
    signalTs: op.signalTs, seenAt, decidedAt, infoCutoff: d.infoCutoff, labelReadyAt: closed ? sim.exitTs : null,
    features: d.features, reason: d.reason, outcomeStatus, voidReason, standaloneQty: o.standaloneQty,
    fillTs: sim.fillTs, fillPrice: sim.fillPrice, exitTs: closed ? sim.exitTs : null, exitPrice: closed ? sim.exitPrice : null,
    exitReason: closed ? sim.exitReason : null, ambiguous: sim.ambiguous,
    grossPc: closed ? sim.gross : null, feesPc: closed ? sim.fees : null,
    slipPc: closed ? Math.round(((sim.entrySlip ?? 0) + (sim.exitSlip ?? 0)) * pointValue(op.symbol) * 100) / 100 : null,
    netPc: closed ? sim.net : null, riskPc: sim.risk, quality, quarantined: !!flag, snapshotHash: d.snapshotHash, ideaExitTs: op.exitTs,
  };
}

/** Every example of one chunk, both modes. */
export function replayChunk(input: {
  bars: Bar[]; symbol: "MES" | "MNQ"; month: string; ctx: ContextRowLike[]; lagSec: number; flags: FlaggedWindow[]; rules?: typeof HIST_RULES;
}): { ideas: number; examples: ReplayExample[] } {
  const rules = input.rules ?? HIST_RULES;
  const { start, end } = monthBounds(input.month);
  const ideas = streamIdeas(input.bars, input.symbol, start, end, input.ctx);
  const examples: ReplayExample[] = [];
  for (const op of ideas) for (const mode of rules.modes) examples.push(replayIdea(op, input.bars, mode, input.lagSec, input.month, input.flags, rules));
  return { ideas: ideas.length, examples };
}

/** Sessions a session key belongs to (the learner's trading day). */
export const sessionOf = (ts: number) => tradingDayKey(ts);
