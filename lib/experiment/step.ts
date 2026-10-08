/* One 15-minute batch of the experimental learner. Pure: same input, same
   output, no clock and no I/O — the store persists what this returns in one
   transaction together with the advanced cursor.

   Order inside a batch:
   1. Replay every newly closed bar in time order: fill pending orders, manage
      open trades, step the shadow outcomes, roll the trading day, and apply
      the daily-loss and drawdown stops after each bar.
   2. Judge freshness. A market whose newest bar is too old during the entry
      window is "stale": no new entries, and its open trades are marked stale
      (priced at their last mark, flagged, never closed by invention).
   3. Decide every new idea once — take, or skip with a reason — with its
      features frozen, its provenance labelled and a one-contract shadow
      outcome opened so skipped ideas are judged by the same rules. */

import type { Bar } from "@/lib/types";
import { inEntryWindow } from "@/lib/time/session";
import { tradingDayKey } from "@/lib/time/ny";
import { EXP_RISK, COMMISSION_RT, perContractRisk, sizeExperimentTrade, standaloneQty } from "./policy";
import { BAR_SEC, direction, fillEntry, flattenAtSession, forceClose, newSimTrade, stepOpen, unrealized } from "./execution";
import { contextIndex, freezeFeatures, EXP_FEATURE_VERSION, type ContextIndex } from "./features";
import { scoreOpportunity } from "./models";
import { stableHash } from "./hash";
import { PREREG } from "./prereg";
import type { QuotaLevel } from "./quota";
import type {
  Account, Decision, DecisionReason, ExperimentConfig, ExpSymbol, Fill, ModelArtifact, Opportunity, Outcome, Position, Provenance, SimTrade, SkipReason,
} from "./types";
import { EXP_SYMBOLS } from "./types";

export type Freshness = "current" | "delayed" | "stale" | "unavailable";
export const DELAYED_SEC = 1200;
export const STALE_SEC = 2700;

export interface ScoredModel {
  versionId: string;
  artifact: ModelArtifact;
}

export interface TickInput {
  exp: ExperimentConfig;
  account: Account;
  positions: Position[];
  outcomes: Outcome[];
  bars: Partial<Record<ExpSymbol, Bar[]>>;
  opportunities: Opportunity[];
  model: ScoredModel;
  challengers: ScoredModel[];
  nowSec: number;
  /** Force a provenance (synthetic and replay drivers). */
  provenance?: Provenance;
  quota: QuotaLevel;
}

export interface ShadowScore {
  decisionKey: string;
  versionId: string;
  p: number | null;
  wouldTake: boolean;
}

export interface TickEvent {
  kind: "locked" | "day_halted";
  at: number;
  reason: string;
}

export interface TickResult {
  account: Account;
  positions: Position[];
  newPositionIds: string[];
  outcomes: Outcome[];
  newOutcomeKeys: string[];
  decisions: Decision[];
  fills: Fill[];
  shadowScores: ShadowScore[];
  events: TickEvent[];
  freshness: Record<ExpSymbol, Freshness>;
  locked: boolean;
  barsProcessed: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const done = (t: SimTrade) => t.status === "closed" || t.status === "cancelled";

/* Reasons where no fill is definable, so the shadow outcome is void. */
const VOID_REASONS = new Set<DecisionReason>(["stale-data", "session-over", "idea-closed", "stop-breached", "target-passed", "stop-too-small", "no-risk", "model-invalid", "late-source"]);

function fillRecords(before: SimTrade, after: SimTrade, positionId: string): Fill[] {
  const out: Fill[] = [];
  const d = direction(after.side);
  if (before.fillTs === null && after.fillTs !== null && after.fillPrice !== null) {
    out.push({
      key: `${positionId}:entry`, positionId, kind: "entry", barTime: after.fillTs, rawPrice: round2(after.fillPrice - d * (after.entrySlip ?? 0)),
      slippagePoints: after.entrySlip ?? 0, price: after.fillPrice, qty: after.qty, commission: round2((COMMISSION_RT / 2) * after.qty),
    });
  }
  if (before.status !== "closed" && after.status === "closed" && after.exitPrice !== null && after.exitTs !== null) {
    out.push({
      key: `${positionId}:exit`, positionId, kind: "exit", barTime: after.exitTs, rawPrice: round2(after.exitPrice + d * (after.exitSlip ?? 0)),
      slippagePoints: after.exitSlip ?? 0, price: after.exitPrice, qty: after.qty, commission: round2((COMMISSION_RT / 2) * after.qty),
    });
  }
  return out;
}

export function freshnessOf(lastBarEnd: number | null, nowSec: number): Freshness {
  if (lastBarEnd === null) return "unavailable";
  if (!inEntryWindow(nowSec)) return "current";
  const age = nowSec - lastBarEnd;
  if (age > STALE_SEC) return "stale";
  if (age > DELAYED_SEC) return "delayed";
  return "current";
}

export function stepTick(input: TickInput): TickResult {
  const { exp, nowSec } = input;
  const account: Account = { ...input.account, cursor: { ...input.account.cursor }, staleSymbols: [...input.account.staleSymbols] };
  const positions = new Map(input.positions.map((p) => [p.id, { ...p }]));
  const outcomes = new Map(input.outcomes.map((o) => [o.decisionKey, { ...o, sim: { ...o.sim } }]));
  const changedPositions = new Set<string>();
  const changedOutcomes = new Set<string>();
  const fills: Fill[] = [];
  const events: TickEvent[] = [];
  let barsProcessed = 0;

  const closed = (bars: Bar[] | undefined) => (bars ?? []).filter((b) => b.time + BAR_SEC <= nowSec).sort((a, b) => a.time - b.time);
  const barsBy: Record<ExpSymbol, Bar[]> = { MES: closed(input.bars.MES), MNQ: closed(input.bars.MNQ) };
  const barAt: Record<ExpSymbol, Map<number, Bar>> = { MES: new Map(barsBy.MES.map((b) => [b.time, b])), MNQ: new Map(barsBy.MNQ.map((b) => [b.time, b])) };

  const openList = () => [...positions.values()].filter((p) => p.status === "open");
  const equityNow = () => exp.capital + account.realized + openList().reduce((a, p) => a + unrealized(p), 0);
  const openRisk = () => [...positions.values()].filter((p) => p.status === "open" || p.status === "pending_fill").reduce((a, p) => a + (p.risk ?? 0), 0);
  let locked = exp.status === "locked" || account.lockedAt !== null;

  const update = (p: Position, next: SimTrade) => {
    const merged: Position = { ...p, ...next };
    fills.push(...fillRecords(p, merged, p.id));
    if (p.status !== "closed" && merged.status === "closed") account.realized = round2(account.realized + (merged.net ?? 0));
    positions.set(p.id, merged);
    changedPositions.add(p.id);
  };

  const rollDay = (t: number) => {
    const day = tradingDayKey(t);
    if (day !== account.dayKey) {
      account.dayKey = day;
      account.dayStartEquity = round2(equityNow());
      account.dayHalted = false;
    }
  };

  const flattenAll = (at: number, reason: "daily-loss" | "drawdown") => {
    for (const p of [...positions.values()]) if (p.status === "open" || p.status === "pending_fill") update(p, forceClose(p, at, reason));
  };

  const applyLimits = (t: number) => {
    const equity = equityNow();
    account.peak = Math.max(account.peak, equity);
    if (!locked && account.peak - equity >= EXP_RISK.maxDrawdown) {
      locked = true;
      account.lockedAt = t + BAR_SEC;
      flattenAll(t + BAR_SEC, "drawdown");
      events.push({ kind: "locked", at: t + BAR_SEC, reason: `Drawdown reached $${EXP_RISK.maxDrawdown}` });
    } else if (!account.dayHalted && equity - account.dayStartEquity <= -EXP_RISK.dailyLoss) {
      account.dayHalted = true;
      flattenAll(t + BAR_SEC, "daily-loss");
      events.push({ kind: "day_halted", at: t + BAR_SEC, reason: `Daily loss reached $${EXP_RISK.dailyLoss}` });
    }
  };

  // 1. Replay newly closed bars in time order.
  const cursorOf = (s: ExpSymbol) => account.cursor[s] ?? exp.simulationFrom ?? exp.startedAt;
  const times = [...new Set(EXP_SYMBOLS.flatMap((s) => barsBy[s].filter((b) => b.time >= cursorOf(s)).map((b) => b.time)))].sort((a, b) => a - b);
  for (const t of times) {
    rollDay(t);
    for (const s of EXP_SYMBOLS) {
      const bar = barAt[s].get(t);
      if (!bar || t < cursorOf(s)) continue;
      barsProcessed++;
      for (const p of [...positions.values()]) {
        if (p.symbol !== s || done(p)) continue;
        if (p.status === "pending_fill") {
          const others = Math.max(0, openRisk() - (p.risk ?? 0));
          const cap = exp.executionClock === "delayed_market" ? Math.max(0, Math.min(EXP_RISK.riskPerTrade, EXP_RISK.totalOpenRisk - others,
            EXP_RISK.dailyLoss + equityNow() - account.dayStartEquity)) : EXP_RISK.riskPerTrade;
          update(p, fillEntry(p, bar, { maxRisk: cap }));
        }
        else update(p, stepOpen(p, bar));
      }
      for (const o of outcomes.values()) {
        if (o.sim.symbol !== s || o.status === "closed" || o.status === "void") continue;
        const sim = o.sim.status === "pending_fill" ? fillEntry(o.sim, bar) : stepOpen(o.sim, bar);
        if (sim !== o.sim) {
          if (exp.executionClock === "delayed_market" && o.sim.fillTs === null && sim.fillTs !== null && sim.risk !== null) o.standaloneQty = standaloneQty(sim.risk);
          o.sim = sim;
          o.status = sim.status === "open" ? "open" : sim.status === "closed" ? "closed" : sim.status === "cancelled" ? "void" : "pending";
          if (sim.status === "cancelled") o.voidReason = sim.cancelReason;
          changedOutcomes.add(o.decisionKey);
        }
      }
      account.cursor[s] = t + BAR_SEC;
    }
    applyLimits(t);
  }

  // 2. Freshness.
  const lastBarEnd = (s: ExpSymbol) => {
    const last = barsBy[s].at(-1);
    return last ? last.time + BAR_SEC : account.cursor[s] ?? null;
  };
  const freshness = { MES: freshnessOf(lastBarEnd("MES"), nowSec), MNQ: freshnessOf(lastBarEnd("MNQ"), nowSec) } as Record<ExpSymbol, Freshness>;
  account.staleSymbols = EXP_SYMBOLS.filter((s) => freshness[s] === "stale" || freshness[s] === "unavailable");
  for (const p of positions.values()) {
    if (p.status !== "open") continue;
    const stale = account.staleSymbols.includes(p.symbol);
    if (stale !== p.stale) {
      positions.set(p.id, { ...p, stale });
      changedPositions.add(p.id);
    }
  }

  // 3. Decide new ideas.
  const decisions: Decision[] = [];
  const shadowScores: ShadowScore[] = [];
  const newPositionIds: string[] = [];
  const newOutcomeKeys: string[] = [];
  const contexts: Partial<Record<ExpSymbol, ContextIndex>> = {};
  const ctxFor = (s: ExpSymbol) => (contexts[s] ??= contextIndex(barsBy[s]));

  for (const op of input.opportunities) {
    const key = `${exp.id}:${op.key}`;
    const sessionKey = tradingDayKey(op.signalTs);
    const last = barsBy[op.symbol].at(-1) ?? null;
    const infoCutoff = last ? last.time + BAR_SEC : Math.floor(nowSec / BAR_SEC) * BAR_SEC;
    const refPrice = last ? last.close : null;
    const provenance: Provenance = input.provenance ?? (nowSec - op.seenAt > PREREG.gates.lateThresholdSec ? "late" : "prospective");
    const d = direction(op.side);
    // Account-level reasons come first; structural ones also decide whether
    // the shadow outcome is definable at all (a void outcome teaches nothing).
    let accountReason: SkipReason | null = null;
    if (exp.status === "paused" || exp.status === "stopped") accountReason = "paused";
    else if (locked) accountReason = "locked";
    else if (account.dayHalted) accountReason = "daily-loss";
    else if (input.quota === "essential") accountReason = "quota";
    let structural: SkipReason | null = null;
    if (op.lateSource) structural = "late-source";
    else if (account.staleSymbols.includes(op.symbol) || refPrice === null) structural = "stale-data";
    else if (nowSec >= flattenAtSession(sessionKey) || !inEntryWindow(nowSec)) structural = "session-over";
    else if (op.exitTs !== null && op.exitTs <= nowSec) structural = "idea-closed";
    else if (d > 0 ? refPrice <= op.stop : refPrice >= op.stop) structural = "stop-breached";
    else if (op.target !== null && (d > 0 ? refPrice >= op.target : refPrice <= op.target)) structural = "target-passed";
    else if (Math.abs(refPrice - op.stop) < EXP_RISK.minStopPoints) structural = "stop-too-small";
    let reason: DecisionReason | null = accountReason ?? structural;

    const features = structural ? null : freezeFeatures(op, ctxFor(op.symbol), infoCutoff);
    let pWin: number | null = null, threshold: number | null = null, take = false;
    if (features) {
      const scored = scoreOpportunity(input.model.artifact, features); // throws ModelOutputError on bad output
      pWin = scored.p;
      threshold = scored.threshold;
      take = scored.take;
      for (const c of input.challengers) {
        try {
          const s = scoreOpportunity(c.artifact, features);
          shadowScores.push({ decisionKey: key, versionId: c.versionId, p: s.p, wouldTake: s.take });
        } catch {
          /* a broken challenger is quarantined by the job; it never blocks a decision */
        }
      }
    }
    if (!reason && !take) reason = "model-skip";

    let qty = 0, estRisk: number | null = null;
    const contractRisk = refPrice === null ? NaN : perContractRisk(op.symbol, refPrice, op.stop, nowSec);
    if (!reason) {
      const equity = equityNow();
      const sized = sizeExperimentTrade(
        { equity, peak: Math.max(account.peak, equity), dailyPnl: equity - account.dayStartEquity, openRisk: openRisk(), locked, dayHalted: account.dayHalted },
        contractRisk,
      );
      if (sized.qty > 0) {
        qty = sized.qty;
        estRisk = round2(contractRisk * qty);
        reason = "taken";
      } else reason = sized.reason ?? "risk-budget";
    }

    const decision: Decision = {
      key, opportunityKey: op.key, signalId: op.signalId, symbol: op.symbol, side: op.side, sessionKey, seenAt: op.seenAt, observedAt: op.observedAt ?? op.seenAt, infoCutoff,
      decidedAt: nowSec, provenance, modelVersionId: input.model.versionId, pWin, threshold, action: reason === "taken" ? "take" : "skip",
      reason: reason!, qty, estRisk, refPrice, idea: op, features, featureVersion: EXP_FEATURE_VERSION,
      snapshotHash: stableHash({ idea: op, features }),
    };
    decisions.push(decision);

    const trade = newSimTrade({ symbol: op.symbol, side: op.side, qty: 1, stop: op.stop, target: op.target, decidedAt: nowSec, sessionKey });
    if (decision.action === "take") {
      const p: Position = { ...trade, qty, risk: estRisk, id: key, decisionKey: key };
      positions.set(p.id, p);
      changedPositions.add(p.id);
      newPositionIds.push(p.id);
    }
    const isVoid = structural !== null || VOID_REASONS.has(decision.reason);
    outcomes.set(key, {
      decisionKey: key, status: isVoid ? "void" : "pending", voidReason: isVoid ? (structural ?? decision.reason) : null, sim: trade,
      standaloneQty: Number.isFinite(contractRisk) ? standaloneQty(contractRisk) : 0,
    });
    changedOutcomes.add(key);
    newOutcomeKeys.push(key);
  }

  // Account snapshot.
  const open = openList();
  const unreal = open.reduce((a, p) => a + unrealized(p), 0);
  const equity = exp.capital + account.realized + unreal;
  account.peak = round2(Math.max(account.peak, equity));
  account.equity = round2(equity);
  account.unrealized = round2(unreal);
  account.unpricedPositions = open.filter((p) => p.stale || p.mark === null).length;
  if (!account.dayKey) {
    account.dayKey = tradingDayKey(nowSec);
    account.dayStartEquity = account.equity;
  }
  account.dailyPnl = round2(equity - account.dayStartEquity);
  account.openRisk = round2(openRisk());
  account.lastOkTickAt = nowSec;

  return {
    account,
    positions: [...changedPositions].map((id) => positions.get(id)!),
    newPositionIds,
    outcomes: [...changedOutcomes].map((k) => outcomes.get(k)!),
    newOutcomeKeys,
    decisions,
    fills,
    shadowScores,
    events,
    freshness,
    locked,
    barsProcessed,
  };
}

/** Pending orders that can no longer fill (used when an experiment is stopped). */
export const pendingIds = (positions: Position[]) => positions.filter((p) => p.status === "pending_fill").map((p) => p.id);
