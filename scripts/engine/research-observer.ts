import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES } from "@/lib/market/contracts";
import { RESEARCH_IDS, RESEARCH_VERSION, ZONE_REJECTION_PARAMS, RSI_CONTEXT_PARAMS } from "@/lib/strategies/research-v2";
import { PAPER_RISK } from "@/lib/paper/policy";
import { EXECUTION, SESSION_EXIT_MINUTE } from "./tiers";
import { transaction } from "@/lib/neon/server";
import { nyMeta } from "@/lib/time/ny";
import { flattenMinuteNy, holidayFor } from "@/lib/market/holidays";
import { stableHash } from "./learning-audit";
import { strategyById } from "@/lib/strategies/registry";
import { researchCodeHash } from "./research-code";

export const candidateKey = (id: string, symbol: string) => `${RESEARCH_VERSION}:${id}:${symbol}`;
export const researchConfig = { version: RESEARCH_VERSION, zone:ZONE_REJECTION_PARAMS, rsi:RSI_CONTEXT_PARAMS, maxRisk: PAPER_RISK.riskPerTrade, execution: EXECUTION,
  dailyLoss: PAPER_RISK.dailyLoss, maxTrades: 2, maxDrawdown: Number.MAX_SAFE_INTEGER, sessionExitMinute: SESSION_EXIT_MINUTE };
export const researchConfigHash = stableHash(researchConfig);
export function researchRequest(strategyId: string, symbol: string, bars: Bar[]) {
  const days = [...new Set(bars.map(b => nyMeta(b.time).dateKey))];
  return { strategyId, params: {}, series: { [symbol]: bars },
    execution: { ...EXECUTION, maxRisk: PAPER_RISK.riskPerTrade, fillModel: "nextOpen" as const, tradableSymbols: [symbol] },
    locks: { dailyLoss: PAPER_RISK.dailyLoss, maxTrades: 2, maxLosses: 2, maxDrawdown: Number.MAX_SAFE_INTEGER },
    startingCapital: PAPER_RISK.capital, sessionExitMinute: SESSION_EXIT_MINUTE,
    sessionExitMinuteByDay: Object.fromEntries(days.map(d => [d, holidayFor(d)?.kind === "closed" ? 0 : flattenMinuteNy(d, SESSION_EXIT_MINUTE)])),
    pointValues: POINT_VALUES, keepOpenAtEnd: true };
}

/** Only positions actually observed open near entry can become forward evidence.
 * A closed trade first discovered during replay is forever historical. */
export async function observeResearch(bySymbol: Record<string, Bar[]>, fromSec: number, asOfSec: number,
  source: "yahoo" | "databento", recoveryId?: string) {
  let recorded = 0;
  const codeHash = researchCodeHash();
  for (const strategyId of RESEARCH_IDS) for (const symbol of ["MES", "MNQ"] as const) {
    const bars = (bySymbol[symbol] ?? []).filter(b => b.time + 300 <= asOfSec);
    if (bars.length < 200) throw new Error(`${symbol}: insufficient bars for research replay`);
    const result = executeRun(researchRequest(strategyId, symbol, bars));
    const rows = result.trades.filter(t => t.entryTime >= fromSec).map(t => ({
      time: t.entryTime, exit: t.exitTime, payload: { ...t, pnl: t.pnl, reason: t.tags?.trigger ?? "Zone first-retest rejection" } }));
    const p = result.openPosition;
    if (p && p.openedAt >= fromSec) rows.push({ time: p.openedAt, exit: null as unknown as number,
      payload: { ...p, entryTime: p.openedAt, entryPrice: p.entry, pnl: null, reason: p.tags?.trigger ?? "Zone first-retest rejection" } as unknown as typeof rows[number]["payload"] });
    await transaction(async client => {
      for (const row of rows) {
        const key = `${candidateKey(strategyId, symbol)}:${source}:${row.time}:${codeHash}`;
        await client.query(`INSERT INTO research_observations(observation_key,candidate_key,strategy_version,source,provenance,signal_ts,exit_ts,payload,recovery_id,code_hash,config_hash)
          VALUES($1,$2,$3,$4,$5,to_timestamp($6),to_timestamp($7),$8,$9,$10,$11)
          ON CONFLICT(observation_key) DO UPDATE SET exit_ts=excluded.exit_ts,payload=excluded.payload
          WHERE research_observations.exit_ts IS NULL`,
          [key, candidateKey(strategyId, symbol), RESEARCH_VERSION, source, "historical-replay", row.time, row.exit, JSON.stringify(row.payload), recoveryId ?? null,codeHash,researchConfigHash]);
        recorded++;
      }
      // Observe the decision BEFORE the next bar arrives. Merely finding an
      // already-open trade would select survivors and bias the forward sample.
      const last = bars.at(-1)!;
      if (!recoveryId && asOfSec - last.time <= 1800) {
        const strategy = strategyById(strategyId), req = researchRequest(strategyId, symbol, bars);
        const ctx = strategy.prepare(req.series, {}, req.execution);
        const signals = strategy.onSnapshot(ctx, { time: last.time, bySymbol: { [symbol]: { bars, index: bars.length - 1 } } }, {}, () => {});
        for (const signal of signals) {
          const m = nyMeta(last.time);
          if (holidayFor(m.dateKey)?.kind === "closed" || m.minutes >= flattenMinuteNy(m.dateKey, SESSION_EXIT_MINUTE)) continue;
          const entry = last.time + 300, key = `${candidateKey(strategyId,symbol)}:${source}:${entry}:${codeHash}`;
          const intent=JSON.stringify({ ...signal, status:"pending", decisionTime:last.time, pnl:null });
          await client.query(`INSERT INTO research_observations(observation_key,candidate_key,strategy_version,source,provenance,signal_ts,payload,intent,code_hash,config_hash)
            VALUES($1,$2,$3,$4,'forward',to_timestamp($5),$6,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [key,candidateKey(strategyId,symbol),RESEARCH_VERSION,source,entry,intent,codeHash,researchConfigHash]);
        }
      }
    });
  }
  return recorded;
}
