import type { ParamValues } from "@/lib/strategies/types";
import type { BacktestResult } from "./engine";
import type { RunRequest } from "./run";
import { runBacktestAsync } from "./client";
import { etWindowLabel } from "@/lib/time/zones";

/* "What if I relax one gate?" — re-run the exact same backtest with a single
   zone-v5 gate loosened, once per applicable gate, and report the trade-count
   and quality deltas. Each relaxation self-guards via applies(), so the table
   only offers gates that are currently restrictive (and offers nothing for
   strategies that lack these params). */

export interface Relaxation {
  id: string;
  label: string;
  explain: string;
  applies: (p: ParamValues) => boolean;
  patch: (p: ParamValues) => ParamValues;
}

export const RELAXATIONS: Relaxation[] = [
  {
    id: "hoursDay",
    label: "Entry session → London + NY",
    explain: `Allow entries ${etWindowLabel("02:00", "15:25")} instead of NY-only.`,
    applies: (p) => p.entryHours === "rth",
    patch: (p) => ({ ...p, entryHours: "day" }),
  },
  {
    id: "hoursAll",
    label: "Entry session → any hour",
    explain: "Allow entries at any hour before the 15:25 flat.",
    applies: (p) => p.entryHours === "rth" || p.entryHours === "day",
    patch: (p) => ({ ...p, entryHours: "all" }),
  },
  {
    id: "intermarketOff",
    label: "Intermarket confirmation → off",
    explain: "Stop requiring MES/MNQ directional agreement.",
    applies: (p) => p.intermarket === true,
    patch: (p) => ({ ...p, intermarket: false }),
  },
  {
    id: "secondZoneOff",
    label: "Second-zone rule → off",
    explain: "Take the first market to reach its zone on fast approaches.",
    applies: (p) => p.secondZone === true,
    patch: (p) => ({ ...p, secondZone: false }),
  },
  {
    id: "achievedOff",
    label: "Weak-zone filter → off",
    explain: "Also trade 1H zones that have not achieved anything.",
    applies: (p) => p.requireAchieved === "ny" || p.requireAchieved === "always",
    patch: (p) => ({ ...p, requireAchieved: "off" }),
  },
  {
    id: "htfWider",
    label: "HTF zone range → +2 heights",
    explain: "Watch Daily/4H zones from further away, catching more touches.",
    applies: (p) => typeof p.htfRange === "number" && p.htfRange < 8,
    patch: (p) => ({ ...p, htfRange: Math.min(8, Number(p.htfRange) + 2) }),
  },
  {
    id: "minScoreZero",
    label: "Minimum score → 0",
    explain: "Take every qualified setup regardless of zone score.",
    applies: (p) => Number(p.minScore) > 0,
    patch: (p) => ({ ...p, minScore: 0 }),
  },
  {
    id: "limitEntry",
    label: "Entry trigger → resting limit",
    explain: "Fill on the zone touch instead of waiting for a confirmation candle.",
    applies: (p) => p.entryStyle === "confirm",
    patch: (p) => ({ ...p, entryStyle: "limit" }),
  },
  {
    id: "directional",
    label: "Nesting mode → directional",
    explain: "Require only same-side Daily/4H/1H agreement, not rectangle nesting.",
    applies: (p) => p.mode === "strict",
    patch: (p) => ({ ...p, mode: "directional" }),
  },
  {
    id: "fullStructure",
    label: "Zone structure → full globex",
    explain: "Build zones from all ~23h bars (historically LOSES — overnight wicks eat freshness).",
    applies: (p) => p.structure === "rth",
    patch: (p) => ({ ...p, structure: "full" }),
  },
];

export interface WhatIfRow {
  id: string;
  label: string;
  explain: string;
  trades: number;
  addedTrades: number;
  tradesPerSession: number;
  net: number;
  profitFactor: number;
  maxDrawdown: number;
}

export async function runWhatIf(
  baseReq: RunRequest,
  baseResult: BacktestResult,
  onProgress?: (done: number, total: number) => void
): Promise<WhatIfRow[]> {
  const applicable = RELAXATIONS.filter((r) => r.applies(baseReq.params));
  const rows: WhatIfRow[] = [];
  let done = 0;
  onProgress?.(0, applicable.length);
  for (const r of applicable) {
    // Sequential on purpose: a single worker services runs, and the Compare
    // page already proves this cost profile (6 sequential 60d runs).
    const res = await runBacktestAsync({
      ...baseReq,
      params: r.patch(baseReq.params),
      collectEvents: false,
    });
    rows.push({
      id: r.id,
      label: r.label,
      explain: r.explain,
      trades: res.metrics.trades,
      addedTrades: res.metrics.trades - baseResult.metrics.trades,
      tradesPerSession: res.sessions ? res.metrics.trades / res.sessions : 0,
      net: res.metrics.net,
      profitFactor: res.metrics.profitFactor,
      maxDrawdown: res.metrics.maxDrawdown,
    });
    onProgress?.(++done, applicable.length);
  }
  return rows.sort((a, b) => b.addedTrades - a.addedTrades);
}
