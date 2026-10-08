/* A portfolio replay on the delayed market clock, not the wall clock.
   Each decision sees only bars closed at its event. Later bars cannot affect
   its features or eligibility. Every result is explicitly replay evidence. */
import { BAR_SEC } from "./execution";
import { freshnessOf, stepTick, type TickInput, type TickResult } from "./step";
import { EXP_SYMBOLS, type Position, type Outcome } from "./types";

export const DELAYED_EXECUTION_VERSION = "delayed-market-2026-10-08-v1";
export const MAX_BATCH_EVENTS = 144;

export function stepDelayed(input: TickInput, watermarks: Partial<Record<"MES" | "MNQ", number>>): TickResult {
  const from = input.exp.simulationFrom ?? input.exp.startedAt;
  const cursor = (s: "MES" | "MNQ") => input.account.cursor[s] ?? from;
  // The slowest feed sets the shared portfolio horizon. Never move ahead of
  // a completed publication or allow later symbol bars to leak into a decision.
  const horizon = Math.min(...EXP_SYMBOLS.map((s) => watermarks[s] ?? from), input.nowSec);
  const first = Math.min(...EXP_SYMBOLS.map(cursor));
  const allTimes = [...new Set(EXP_SYMBOLS.flatMap((s) => (input.bars[s] ?? [])
    .filter((b) => b.time >= cursor(s) && b.time + BAR_SEC <= horizon).map((b) => b.time + BAR_SEC)))].sort((a, b) => a - b);
  const times = allTimes.slice(0, MAX_BATCH_EVENTS);
  // A late correction is audited at the current cursor instead of silently
  // rewinding an already credited portfolio.
  if (!times.length && input.opportunities.some((o) => o.signalTs + BAR_SEC <= first)) times.push(first);
  const positions = new Map<string, Position>(input.positions.map((p) => [p.id, p]));
  const outcomes = new Map<string, Outcome>(input.outcomes.map((o) => [o.decisionKey, o]));
  const changedP = new Set<string>(), changedO = new Set<string>(), decided = new Set<string>();
  let account = input.account;
  const result: TickResult = { account, positions: [], outcomes: [], decisions: [], fills: [], shadowScores: [], events: [],
    newPositionIds: [], newOutcomeKeys: [], freshness: { MES: "unavailable", MNQ: "unavailable" }, locked: false, barsProcessed: 0 };
  for (const at of times) {
    const ops = input.opportunities.filter((o) => !decided.has(o.key) && o.signalTs + BAR_SEC <= at)
      .map((o) => ({ ...o, observedAt: o.observedAt ?? o.seenAt, seenAt: o.signalTs + BAR_SEC,
        exitTs: null, lateSource: o.signalTs + BAR_SEC <= cursor(o.symbol) }));
    const r = stepTick({ ...input, account, nowSec: at, provenance: "replay",
      bars: Object.fromEntries(EXP_SYMBOLS.map((s) => [s, (input.bars[s] ?? []).filter((b) => b.time + BAR_SEC <= at)])),
      opportunities: ops, positions: [...positions.values()].filter((p) => p.status === "open" || p.status === "pending_fill"),
      outcomes: [...outcomes.values()].filter((o) => o.status === "pending" || o.status === "open"),
      exp: { ...input.exp, status: result.locked ? "locked" : input.exp.status } });
    account = r.account;
    for (const p of r.positions) { positions.set(p.id, p); changedP.add(p.id); }
    for (const o of r.outcomes) { outcomes.set(o.decisionKey, o); changedO.add(o.decisionKey); }
    for (const d of r.decisions) decided.add(d.opportunityKey);
    result.decisions.push(...r.decisions); result.fills.push(...r.fills); result.shadowScores.push(...r.shadowScores);
    result.events.push(...r.events); result.newPositionIds.push(...r.newPositionIds); result.newOutcomeKeys.push(...r.newOutcomeKeys);
    result.barsProcessed += r.barsProcessed; result.locked ||= r.locked;
  }
  const dataAsOf = Math.min(...EXP_SYMBOLS.map((s) => account.cursor[s] ?? from));
  result.freshness = Object.fromEntries(EXP_SYMBOLS.map((s) => [s, freshnessOf(watermarks[s] ?? null, input.nowSec)])) as TickResult["freshness"];
  const staleSymbols = EXP_SYMBOLS.filter((s) => result.freshness[s] === "stale" || result.freshness[s] === "unavailable");
  for (const p of positions.values()) if (p.status === "open" && p.stale !== staleSymbols.includes(p.symbol)) {
    positions.set(p.id, { ...p, stale: staleSymbols.includes(p.symbol) }); changedP.add(p.id);
  }
  result.account = { ...account, cursor: { ...account.cursor }, dataAsOf, lastOkTickAt: input.nowSec,
    staleSymbols: [...staleSymbols], unpricedPositions: [...positions.values()].filter((p) => p.status === "open" && p.stale).length,
    backlogCount: allTimes.length - Math.min(allTimes.length, MAX_BATCH_EVENTS) + input.opportunities.filter((o) => !decided.has(o.key) && o.signalTs + BAR_SEC <= horizon).length };
  result.positions = [...changedP].map((id) => positions.get(id)!);
  result.outcomes = [...changedO].map((id) => outcomes.get(id)!);
  return result;
}
