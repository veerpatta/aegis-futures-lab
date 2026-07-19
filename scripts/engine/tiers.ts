/* The live signal tiers, tuned 2026-07-19 on the trailing 60 days of delayed
   Yahoo 5m data (scripts/engine/report.ts reproduces the numbers).

   Tier A — high conviction: Zone Engine v5 with the app's tuned defaults
   (RTH structure, resting limit entry, 2R target, intermarket confirmation,
   weak-zone filter). ~0.3-0.4 trades/day, clustered on the days price
   reaches Daily/4H structure. PF ≈ 1.35 on the tuning window.

   Tier B — daily flow: RSI mean-reversion (25/75 bands, London+NY session,
   1.5×ATR stop, 1.5R target) run independently per symbol with tight daily
   discipline locks (max 2 trades, stop after 2 losses or -$250). ~2/day
   combined, PF ≈ 1.2-1.3 on the tuning window. The locks are part of the
   edge: without them the same params grind at PF ≈ 1.1.

   Combined on the tuning window: 2.76 signals/day, ≥1 signal on 45/49
   trading days, all three streams net positive. */

import type { Bar } from "@/lib/types";
import type { DisciplineLocks } from "@/lib/backtest/engine";
import { defaultParams, type ExecutionConfig, type ParamValues } from "@/lib/strategies/types";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";

export const EXECUTION: ExecutionConfig = {
  cost: 2.4,
  slippage: 0.25,
  maxRisk: 160,
  sizing: "risk",
  fillModel: "limit",
};

export const STARTING_CAPITAL = 3000;
export const SESSION_EXIT_MINUTE = 925; // flat by 15:25 ET

export interface TierStream {
  tier: "A" | "B";
  label: string;
  strategyId: string;
  symbols: ("MES" | "MNQ")[]; // one combined run over all listed symbols
  params: ParamValues;
  fillModel: "limit" | "nextOpen";
  locks: DisciplineLocks | null;
}

export const B_LOCKS: DisciplineLocks = {
  dailyLoss: 250,
  maxTrades: 2,
  maxLosses: 2,
  maxDrawdown: 999999,
};

export function tierStreams(): TierStream[] {
  const rsiParams: ParamValues = {
    ...defaultParams(rsiReversion),
    session: "day",
    oversold: 25,
    overbought: 75,
  };
  return [
    {
      tier: "A",
      label: "zone-v5",
      strategyId: "zone-v5",
      symbols: ["MES", "MNQ"],
      params: defaultParams(zoneV5),
      fillModel: "limit",
      locks: null,
    },
    {
      tier: "B",
      label: "rsi-reversion",
      strategyId: "rsi-reversion",
      symbols: ["MES"],
      params: rsiParams,
      fillModel: "nextOpen",
      locks: B_LOCKS,
    },
    {
      tier: "B",
      label: "rsi-reversion",
      strategyId: "rsi-reversion",
      symbols: ["MNQ"],
      params: rsiParams,
      fillModel: "nextOpen",
      locks: B_LOCKS,
    },
  ];
}
