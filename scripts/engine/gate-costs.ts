/* Gate-cost bookkeeping for the nightly learn job. Re-runs the live tier
   streams over the trailing 30 days of ARCHIVED bars and reads the backtest
   engine's own skip-reason funnel (res.skipReasons / res.skipReasonsByDay) —
   the exact machinery the Lab's Frequency Doctor uses. For each gate it
   reports how many tradeable setups that gate removed over the window,
   ranked, with diagnostic (non-blocking) reasons kept separate.

   This is simulation bookkeeping, not a strategy change: it runs the SAME
   streams with the SAME params as the live engine and only counts what the
   gates already do. It never writes signals and never changes a param.

   Honest scope note (carried into the payload): the funnel gives per-gate
   skip COUNTS, not a counterfactual P&L. Pricing "net if this gate were
   removed" would require re-simulating with each gate disabled, which shifts
   every downstream fill/lock — out of scope for a nightly bookkeeping pass.
   The count is the cost signal: which gate is turning away the most setups. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { FUNNEL_LABELS, DIAGNOSTIC_REASONS } from "@/components/lab/funnel";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "./tiers";

export const GATE_COST_LOOKBACK_DAYS = 30;
const PAGE = 1000;
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];

async function trailingBars(supabase: SupabaseClient, symbol: FeedSymbol, fromSec: number): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .gte("time", fromSec)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read for ${symbol}: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface GateCost {
  reason: string;
  label: string;
  count: number;
  diagnostic: boolean;
}

export interface GateCostPayload {
  lookbackDays: number;
  window: { fromSec: number; toSec: number };
  bars: Record<string, number>;
  gates: GateCost[]; // blocking gates, ranked by count desc
  diagnostics: GateCost[]; // non-blocking pipeline reasons, for context
  note: string;
}

export async function computeGateCosts(supabase: SupabaseClient, nowSec: number): Promise<GateCostPayload> {
  const fromSec = nowSec - GATE_COST_LOOKBACK_DAYS * 86400;
  const bars: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) bars[s] = await trailingBars(supabase, s, fromSec);

  const totals = new Map<string, number>();
  for (const stream of tierStreams()) {
    const series = Object.fromEntries(stream.symbols.map((s) => [s, bars[s] ?? []]));
    if (Object.values(series).every((b) => !b.length)) continue;
    const res = executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series,
      execution: { ...EXECUTION, fillModel: stream.fillModel },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      pointValues: POINT_VALUES,
    });
    for (const [reason, count] of Object.entries(res.skipReasons))
      totals.set(reason, (totals.get(reason) ?? 0) + count);
  }

  const toCost = (reason: string, count: number): GateCost => ({
    reason,
    label: FUNNEL_LABELS[reason] ?? reason,
    count,
    diagnostic: DIAGNOSTIC_REASONS.has(reason),
  });
  const all = [...totals.entries()].map(([reason, count]) => toCost(reason, count));

  return {
    lookbackDays: GATE_COST_LOOKBACK_DAYS,
    window: { fromSec, toSec: nowSec },
    bars: Object.fromEntries(SYMBOLS.map((s) => [s, bars[s]?.length ?? 0])),
    gates: all.filter((g) => !g.diagnostic).sort((a, b) => b.count - a.count),
    diagnostics: all.filter((g) => g.diagnostic).sort((a, b) => b.count - a.count),
    note: "Counts are setups each gate turned away over the window (the engine's own skip funnel), not counterfactual P&L.",
  };
}
