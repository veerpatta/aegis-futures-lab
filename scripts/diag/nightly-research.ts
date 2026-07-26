/* One-off read-only pull for the nightly research analyst run. Prints JSON
   sections to stdout; nothing here writes to Supabase. */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY
);

async function main() {
  for (const table of ["engine_runs", "signals", "shadow_signals"]) {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    console.log(`=== schema ${table} ===`);
    if (error) console.log("ERROR", error.message);
    else console.log(data && data[0] ? Object.keys(data[0]) : "no rows");
  }

  const now = new Date();
  const since26h = new Date(now.getTime() - 26 * 3600 * 1000).toISOString();
  const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const { data: runs, error: runsErr } = await supabase
    .from("engine_runs")
    .select("*")
    .gte("ran_at", since26h)
    .order("ran_at", { ascending: true });
  console.log("=== engine_runs (26h) ===");
  if (runsErr) console.log("ERROR:", runsErr.message);
  else console.log(JSON.stringify(runs, null, 2));

  const { data: signals, error: sigErr } = await supabase
    .from("signals")
    .select("id,tier,symbol,regime,fill_confidence,win_prob,model_veto,stale_data,status,exit_ts,pnl_usd,signal_ts")
    .not("exit_ts", "is", null)
    .gte("exit_ts", since24h)
    .order("exit_ts", { ascending: true });
  console.log("\n=== signals closed (24h) ===");
  if (sigErr) console.log("ERROR:", sigErr.message);
  else console.log(JSON.stringify(signals, null, 2));

  const { data: shadow, error: shadowErr } = await supabase
    .from("shadow_signals")
    .select("id,strategy,symbol,regime,fill_confidence,win_prob,model_veto,stale_data,status,exit_ts,pnl_usd,signal_ts")
    .not("exit_ts", "is", null)
    .gte("exit_ts", since24h)
    .order("exit_ts", { ascending: true });
  console.log("\n=== shadow_signals closed (24h) ===");
  if (shadowErr) console.log("ERROR:", shadowErr.message);
  else console.log(JSON.stringify(shadow, null, 2));

  const keys = ["gate_costs", "fill_reality", "condition_ledger", "shadow_scoreboard", "score_calibration", "daily_funnel"];
  for (const key of keys) {
    const { data, error } = await supabase
      .from("learned_stats")
      .select("*")
      .eq("stat_key", key)
      .order("date_key", { ascending: false })
      .limit(1);
    console.log(`\n=== learned_stats: ${key} (newest) ===`);
    if (error) console.log("ERROR:", error.message);
    else console.log(JSON.stringify(data, null, 2));
  }

  const { data: registry, error: regErr } = await supabase
    .from("model_registry")
    .select("*")
    .order("trained_at", { ascending: false })
    .limit(5);
  console.log("\n=== model_registry (last 5) ===");
  if (regErr) console.log("ERROR:", regErr.message);
  else console.log(JSON.stringify(registry, null, 2));

  const { data: policy, error: polErr } = await supabase
    .from("bot_policy")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(10);
  console.log("\n=== bot_policy (last 10) ===");
  if (polErr) console.log("ERROR:", polErr.message);
  else console.log(JSON.stringify(policy, null, 2));

  // Rolling PF over last 20 closed signals per stream (tier+symbol), real signals only.
  const { data: recentAll, error: recentErr } = await supabase
    .from("signals")
    .select("id,tier,symbol,status,exit_ts,pnl_usd")
    .not("exit_ts", "is", null)
    .order("exit_ts", { ascending: false })
    .limit(500);
  console.log("\n=== signals recent 500 (for rolling PF calc) ===");
  if (recentErr) console.log("ERROR:", recentErr.message);
  else {
    type RecentRow = { tier: string | null; symbol: string; pnl_usd: number | null };
    const byStream = new Map<string, RecentRow[]>();
    for (const row of (recentAll || []) as RecentRow[]) {
      const key = `${row.tier}:${row.symbol}`;
      if (!byStream.has(key)) byStream.set(key, []);
      const arr = byStream.get(key)!;
      if (arr.length < 20) arr.push(row);
    }
    const pf: Record<string, { n: number; pf: number | null; gains: number; losses: number }> = {};
    for (const [key, rows] of byStream.entries()) {
      const gains = rows.filter((r) => (r.pnl_usd ?? 0) > 0).reduce((s, r) => s + (r.pnl_usd ?? 0), 0);
      const losses = Math.abs(rows.filter((r) => (r.pnl_usd ?? 0) < 0).reduce((s, r) => s + (r.pnl_usd ?? 0), 0));
      pf[key] = { n: rows.length, pf: losses > 0 ? +(gains / losses).toFixed(2) : null, gains, losses };
    }
    console.log(JSON.stringify(pf, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
