/* Scheduled paper-signal engine (GitHub Actions, every 15 min in market
   hours). Each run is a full deterministic recompute over the trailing 60
   days of delayed Yahoo 5m data:

     fetch bars → run every tier stream (tiers.ts) through the one backtest
     simulator → upsert the last LOOKBACK_DAYS of simulated trades as signal
     rows (stable dedupe keys, so statuses transition in place) → snapshot
     the current zone stacks → heartbeat row in engine_runs.

   Idempotent by construction: re-running with the same data writes the same
   rows, so cron jitter and manual re-runs are harmless.
   Run with: npx tsx scripts/engine/run-live.ts */

import { createClient } from "@supabase/supabase-js";
import type { Bar, Trade } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES } from "@/lib/market/contracts";
import type { OpenPosition } from "@/lib/strategies/types";
import { fetchYahooBars } from "./data";
import { zoneRows } from "./zone-rows";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "./tiers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

const LOOKBACK_DAYS = 7; // how far back simulated trades are mirrored as signal rows

const url = process.env.SUPABASE_URL || SUPABASE_URL;
const key = process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

interface SignalRow {
  dedupe_key: string;
  tier: "A" | "B";
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
  updated_at: string;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

function rowFromTrade(tier: "A" | "B", label: string, t: Trade): SignalRow {
  const status =
    t.exitReason === "target" ? "hit_target" : t.exitReason === "stop" ? "hit_stop" : "expired";
  const stopDist = Math.abs(t.entryPrice - t.stop);
  return {
    dedupe_key: `${tier}:${label}:${t.symbol}:${t.entryTime}`,
    tier,
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
    reason: `${label}: ${t.tags?.pattern ?? t.tags?.trigger ?? "signal"}`,
    signal_ts: iso(t.entryTime),
    exit_ts: iso(t.exitTime),
    exit_price: t.exitPrice,
    pnl_usd: +t.pnl.toFixed(2),
    risk_usd: t.rMultiple ? +Math.abs(t.pnl / t.rMultiple).toFixed(2) : null,
    updated_at: new Date().toISOString(),
  };
}

function rowFromOpen(tier: "A" | "B", label: string, p: OpenPosition): SignalRow {
  const stopDist = Math.abs(p.entry - p.stop);
  return {
    dedupe_key: `${tier}:${label}:${p.symbol}:${p.openedAt}`,
    tier,
    symbol: p.symbol,
    timeframe: p.tags?.entryTf ?? "5m",
    direction: p.side === "LONG" ? "long" : "short",
    entry_price: p.entry,
    stop_price: p.stop,
    target_price: p.target,
    rr:
      p.target !== null && stopDist > 0
        ? +(Math.abs(p.target - p.entry) / stopDist).toFixed(2)
        : null,
    qty: p.qty,
    score: p.score ?? null,
    status: "triggered",
    reason: `${label}: ${p.tags?.pattern ?? p.tags?.trigger ?? "signal"} (open)`,
    signal_ts: iso(p.openedAt),
    exit_ts: null,
    exit_price: null,
    pnl_usd: null,
    risk_usd: +p.risk.toFixed(2),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const started = Date.now();
  const runStartIso = new Date().toISOString();
  const [mes, mnq] = await Promise.all([fetchYahooBars("MES"), fetchYahooBars("MNQ")]);
  const bySymbol: Record<string, Bar[]> = { MES: mes, MNQ: mnq };
  const nowSec = Math.floor(started / 1000);
  const cutoff = nowSec - LOOKBACK_DAYS * 86400;

  // 1) Signals from every tier stream.
  const signalRows = new Map<string, SignalRow>();
  let tierA = 0;
  let tierB = 0;
  for (const stream of tierStreams()) {
    const res = executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series: Object.fromEntries(stream.symbols.map((s) => [s, bySymbol[s]])),
      execution: { ...EXECUTION, fillModel: stream.fillModel },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      pointValues: POINT_VALUES,
      keepOpenAtEnd: true,
    });
    for (const t of res.trades) {
      if (t.entryTime < cutoff) continue;
      const row = rowFromTrade(stream.tier, stream.label, t);
      signalRows.set(row.dedupe_key, row);
    }
    if (res.openPosition && res.openPosition.openedAt >= cutoff) {
      const row = rowFromOpen(stream.tier, stream.label, res.openPosition);
      signalRows.set(row.dedupe_key, row);
    }
    const n = res.trades.filter((t) => t.entryTime >= cutoff).length + (res.openPosition ? 1 : 0);
    if (stream.tier === "A") tierA += n;
    else tierB += n;
    console.log(
      `${stream.tier} ${stream.label} ${stream.symbols.join("+")}: ${n} signals in last ${LOOKBACK_DAYS}d`
    );
  }
  const signals = [...signalRows.values()];
  if (signals.length) {
    const { error } = await supabase.from("signals").upsert(signals, { onConflict: "dedupe_key" });
    if (error) throw new Error(`signals upsert: ${error.message}`);
  }

  // 2) Zone snapshot (tier-A structure: NY-session bars only).
  const zones = [...zoneRows("MES", mes, nowSec), ...zoneRows("MNQ", mnq, nowSec)];
  if (zones.length) {
    const { error } = await supabase.from("zones").upsert(zones, { onConflict: "dedupe_key" });
    if (error) throw new Error(`zones upsert: ${error.message}`);
  }
  // Zones not refreshed this run are gone from the current stack (consumed,
  // out of the nearest-N window, or from an older schema) — drop them.
  {
    const { error } = await supabase.from("zones").delete().lt("updated_at", runStartIso);
    if (error) throw new Error(`zones cleanup: ${error.message}`);
  }

  // 3) Heartbeat.
  const { error: runError } = await supabase.from("engine_runs").insert({
    status: "ok",
    symbols: ["MES", "MNQ"],
    zones_upserted: zones.length,
    signals_created: signals.length,
    tier_a_signals: tierA,
    tier_b_signals: tierB,
    duration_ms: Date.now() - started,
    source: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    message: `bars MES ${mes.length} / MNQ ${mnq.length}, last ${iso(
      Math.min(mes[mes.length - 1].time, mnq[mnq.length - 1].time)
    )}`,
  });
  if (runError) throw new Error(`engine_runs insert: ${runError.message}`);

  console.log(
    `ok: ${signals.length} signal rows (A ${tierA} / B ${tierB}), ${zones.length} zones, ${Date.now() - started}ms`
  );
}

main().catch(async (err) => {
  console.error(err);
  try {
    await supabase.from("engine_runs").insert({
      status: "error",
      symbols: ["MES", "MNQ"],
      source: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
      message: String(err instanceof Error ? err.message : err).slice(0, 500),
    });
  } catch {
    /* best effort */
  }
  process.exit(1);
});
