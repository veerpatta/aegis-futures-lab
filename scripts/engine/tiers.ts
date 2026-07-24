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
import { strategyById } from "@/lib/strategies/registry";

export const EXECUTION: ExecutionConfig = {
  cost: 2.4,
  slippage: 0.25,
  maxRisk: 160,
  sizing: "risk",
  fillModel: "limit",
};

export const STARTING_CAPITAL = 3000;
export const SESSION_EXIT_MINUTE = 925; // flat by 15:25 ET

/* What the tuning window promised (trailing 60d as of 2026-07-19) —
   structured so the dashboard's "Live vs tuning window" panel can compare
   reality against the promise. Bands restate the header notes above; they
   are expectations from one 60-day sample, not guarantees. */
export const GO_LIVE_DATE = "2026-07-19"; // NY dateKey of the first live signals

export interface TuningBaseline {
  key: "A" | "B:MES" | "B:MNQ";
  label: string;
  tier: "A" | "B";
  symbol: "MES" | "MNQ" | null; // null = every symbol the tier trades
  pfBand: [number, number];
  tradesPerDay: [number, number];
}

export const TUNING_BASELINE: TuningBaseline[] = [
  { key: "A", label: "Zone setups · MES+MNQ", tier: "A", symbol: null, pfBand: [1.3, 1.4], tradesPerDay: [0.3, 0.4] },
  { key: "B:MES", label: "Daily flow · MES", tier: "B", symbol: "MES", pfBand: [1.2, 1.3], tradesPerDay: [0.8, 1.2] },
  { key: "B:MNQ", label: "Daily flow · MNQ", tier: "B", symbol: "MNQ", pfBand: [1.2, 1.3], tradesPerDay: [0.8, 1.2] },
];

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

/* ── Bot-editable blocks — the ONLY things the weekly-challenger bot may edit,
   and only ever via a human-merged PR. Both DEFAULT EMPTY, so live behaviour
   (and the golden parity tests) are unchanged until a human merges. Keying:
   "A" for the zone stream, "B:MES"/"B:MNQ" for the RSI streams. */

/** Param overrides adopted from a surviving challenger. */
export const CHALLENGER_OVERRIDES: Record<string, Partial<ParamValues>> = {};

/** Shadow strategies promoted to live tier-B2 streams. */
export const PROMOTED_SHADOWS: { label: string; strategyId: string; symbols: ("MES" | "MNQ")[] }[] = [];

export function streamOverrideKey(tier: "A" | "B", symbols: ("MES" | "MNQ")[]): string {
  return tier === "A" ? "A" : `B:${symbols.join("+")}`;
}

export function tierStreams(): TierStream[] {
  const rsiParams: ParamValues = {
    ...defaultParams(rsiReversion),
    session: "day",
    oversold: 25,
    overbought: 75,
  };
  const base: TierStream[] = [
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
  // Apply human-merged challenger overrides (empty by default → live params).
  const withOverrides = base.map((s) => {
    const ov = CHALLENGER_OVERRIDES[streamOverrideKey(s.tier, s.symbols)];
    return ov ? { ...s, params: { ...s.params, ...ov } as ParamValues } : s;
  });
  // Append human-merged shadow promotions as tier-B2 streams (same B locks).
  const promoted: TierStream[] = PROMOTED_SHADOWS.map((p) => ({
    tier: "B",
    label: p.label,
    strategyId: p.strategyId,
    symbols: p.symbols,
    params: defaultParams(strategyById(p.strategyId)),
    fillModel: "nextOpen",
    locks: B_LOCKS,
  }));
  return [...withOverrides, ...promoted];
}
