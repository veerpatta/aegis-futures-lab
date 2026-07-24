/* Shadow-mode strategy auditions — the cheapest possible forward test.
   The four coded-but-unused strategies run through the SAME simulator, the
   SAME tier-B discipline locks (max 2 trades/day, stop after 2 losses or
   −$250) and the SAME honesty treatment (fill audit, regime tag) as the
   live tiers, per symbol, and their results land in shadow_signals only.

   Quarantine rules: never the signals table, never the blotter, never
   Telegram. A shadow failure can never fail an engine run — the caller
   wraps this block — and a time budget caps how much a slow strategy can
   cost the cron (streams past the budget are skipped this run and picked
   up next run; the recompute is idempotent). */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar, Trade } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES } from "@/lib/market/contracts";
import { defaultParams } from "@/lib/strategies/types";
import { strategyById } from "@/lib/strategies/registry";
import type { OpenPosition } from "@/lib/strategies/types";
import { auditFill } from "./fill-audit";
import { computeRegime } from "./regime";
import { B_LOCKS, EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL } from "./tiers";

export const SHADOW_STRATEGIES = ["vwap-reversion", "orb", "bollinger-breakout", "ema-cross"] as const;
export const SHADOW_SYMBOLS = ["MES", "MNQ"] as const;

export interface ShadowRow {
  dedupe_key: string;
  strategy: string;
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  target_price: number | null;
  rr: number | null;
  qty: number | null;
  score: number | null;
  status: string;
  reason: string;
  signal_ts: string;
  exit_ts: string | null;
  exit_price: number | null;
  pnl_usd: number | null;
  risk_usd: number | null;
  regime: string | null;
  fill_confidence: string | null;
  vix_bucket: string | null;
  updated_at: string;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

function fromTrade(strategy: string, t: Trade): ShadowRow {
  const status =
    t.exitReason === "target" ? "hit_target" : t.exitReason === "stop" ? "hit_stop" : "expired";
  const stopDist = Math.abs(t.entryPrice - t.stop);
  return {
    dedupe_key: `${strategy}:${t.symbol}:${t.entryTime}`,
    strategy,
    symbol: t.symbol,
    timeframe: t.tags?.entryTf ?? "5m",
    direction: t.side === "LONG" ? "long" : "short",
    entry_price: t.entryPrice,
    stop_price: t.stop,
    target_price: t.target,
    rr: t.target !== null && stopDist > 0 ? +(Math.abs(t.target - t.entryPrice) / stopDist).toFixed(2) : null,
    qty: t.qty,
    score: t.score ?? null,
    status,
    reason: `${strategy}: ${t.tags?.pattern ?? t.tags?.trigger ?? "signal"}`,
    signal_ts: iso(t.entryTime),
    exit_ts: iso(t.exitTime),
    exit_price: t.exitPrice,
    pnl_usd: +t.pnl.toFixed(2),
    risk_usd: t.rMultiple ? +Math.abs(t.pnl / t.rMultiple).toFixed(2) : null,
    regime: null,
    fill_confidence: null,
    vix_bucket: null,
    updated_at: new Date().toISOString(),
  };
}

function fromOpen(strategy: string, p: OpenPosition): ShadowRow {
  const stopDist = Math.abs(p.entry - p.stop);
  return {
    dedupe_key: `${strategy}:${p.symbol}:${p.openedAt}`,
    strategy,
    symbol: p.symbol,
    timeframe: p.tags?.entryTf ?? "5m",
    direction: p.side === "LONG" ? "long" : "short",
    entry_price: p.entry,
    stop_price: p.stop,
    target_price: p.target,
    rr: p.target !== null && stopDist > 0 ? +(Math.abs(p.target - p.entry) / stopDist).toFixed(2) : null,
    qty: p.qty,
    score: p.score ?? null,
    status: "triggered",
    reason: `${strategy}: ${p.tags?.pattern ?? p.tags?.trigger ?? "signal"} (open)`,
    signal_ts: iso(p.openedAt),
    exit_ts: null,
    exit_price: null,
    pnl_usd: null,
    risk_usd: +p.risk.toFixed(2),
    regime: null,
    fill_confidence: null,
    vix_bucket: null,
    updated_at: new Date().toISOString(),
  };
}

export interface ShadowResult {
  upserted: number;
  streamsRun: number;
  streamsSkipped: number;
  errors: string[];
}

export async function runShadows(args: {
  supabase: SupabaseClient;
  bySymbol: Record<string, Bar[]>;
  nowSec: number;
  cutoff: number; // mirror window start (same 7-day rule as real signals)
  exitMinuteByDay: Record<string, number>;
  timeBudgetMs: number;
  /** vix_bucket tag for an entry time (context.ts) — same rule as real signals. */
  vixBucketFor?: (entrySec: number) => string | null;
}): Promise<ShadowResult> {
  const { supabase, bySymbol, nowSec, cutoff, exitMinuteByDay, timeBudgetMs } = args;
  const started = Date.now();
  const rows = new Map<string, ShadowRow>();
  const errors: string[] = [];
  let streamsRun = 0;
  let streamsSkipped = 0;

  for (const strategyId of SHADOW_STRATEGIES) {
    for (const symbol of SHADOW_SYMBOLS) {
      if (Date.now() - started > timeBudgetMs) {
        streamsSkipped++;
        continue;
      }
      try {
        const strategy = strategyById(strategyId);
        const res = executeRun({
          strategyId,
          // Sensible defaults from the strategy's own param definitions —
          // auditions run stock settings; tuning them comes only after a
          // stream earns promotion interest.
          params: defaultParams(strategy),
          series: { [symbol]: bySymbol[symbol] ?? [] },
          // All four emit market signals (no resting limits) → nextOpen.
          execution: { ...EXECUTION, fillModel: "nextOpen" },
          locks: B_LOCKS,
          startingCapital: STARTING_CAPITAL,
          sessionExitMinute: SESSION_EXIT_MINUTE,
          sessionExitMinuteByDay: exitMinuteByDay,
          pointValues: POINT_VALUES,
          keepOpenAtEnd: true,
        });
        streamsRun++;
        const stamp = (row: ShadowRow, entrySec: number, exitSec: number | null) => {
          row.regime = computeRegime(bySymbol[symbol] ?? [], entrySec);
          row.vix_bucket = args.vixBucketFor ? args.vixBucketFor(entrySec) : null;
          row.fill_confidence = auditFill({
            fillModel: "nextOpen",
            direction: row.direction,
            limit: row.entry_price,
            entryTime: entrySec,
            exitTime: exitSec,
            bars: bySymbol[symbol] ?? [],
          });
          rows.set(row.dedupe_key, row);
        };
        for (const t of res.trades) {
          if (t.entryTime < cutoff) continue;
          stamp(fromTrade(strategyId, t), t.entryTime, t.exitTime);
        }
        if (res.openPosition && res.openPosition.openedAt >= cutoff)
          stamp(fromOpen(strategyId, res.openPosition), res.openPosition.openedAt, null);
      } catch (e) {
        errors.push(`${strategyId}/${symbol}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const batch = [...rows.values()];
  if (batch.length) {
    const { error } = await supabase
      .from("shadow_signals")
      .upsert(batch, { onConflict: "dedupe_key" });
    if (error) errors.push(`shadow upsert: ${error.message}`);
  }
  return { upserted: batch.length, streamsRun, streamsSkipped, errors };
}
