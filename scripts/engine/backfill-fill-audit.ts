/* One-off backfill: classify fill_confidence for existing signal rows from
   bars_5m history. Rows whose bars aren't archived stay null. Idempotent —
   safe to re-run; the live engine re-stamps anything inside its 7-day
   lookback anyway, so this mainly covers older rows.

   Run with:  npx tsx scripts/engine/backfill-fill-audit.ts

   Writes need the service-role key (RLS blocks anonymous updates). With
   SUPABASE_KEY set, rows are updated directly; without it the script
   PRINTS the equivalent UPDATE statements so they can be pasted into the
   Supabase SQL editor (or run via MCP). */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { auditFill, type FillConfidence } from "./fill-audit";
import { EXECUTION } from "./tiers";

const url = process.env.SUPABASE_URL || SUPABASE_URL;
const key = process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY;
const canWrite = Boolean(process.env.SUPABASE_KEY);
const supabase = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;

async function allBars(symbol: string): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close")
      .eq("symbol", symbol)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const { data: rows, error } = await supabase
    .from("signals")
    .select("id, tier, symbol, direction, entry_price, signal_ts, exit_ts, fill_confidence")
    .order("signal_ts", { ascending: true });
  if (error) throw new Error(`signals read: ${error.message}`);

  const barsBySymbol = new Map<string, Bar[]>();
  for (const s of new Set((rows ?? []).map((r) => r.symbol as string)))
    barsBySymbol.set(s, await allBars(s));

  let updated = 0;
  let skipped = 0;
  const sql: string[] = [];
  for (const r of rows ?? []) {
    const bars = barsBySymbol.get(r.symbol as string) ?? [];
    const entryTime = Math.floor(new Date(r.signal_ts as string).getTime() / 1000);
    // Tier A streams fill on resting limits, tier B at the next open —
    // mirrors scripts/engine/tiers.ts.
    const fillModel = r.tier === "A" ? ("limit" as const) : ("nextOpen" as const);
    const entryPrice = Number(r.entry_price);
    const verdict: FillConfidence | null = auditFill({
      fillModel,
      direction: r.direction as "long" | "short",
      limit:
        fillModel === "limit"
          ? r.direction === "long"
            ? entryPrice - EXECUTION.slippage
            : entryPrice + EXECUTION.slippage
          : entryPrice,
      entryTime,
      exitTime: r.exit_ts ? Math.floor(new Date(r.exit_ts as string).getTime() / 1000) : null,
      bars,
    });
    if (verdict === null) {
      skipped++;
      continue;
    }
    if (verdict === r.fill_confidence) continue;
    if (canWrite) {
      const { error: upErr } = await supabase
        .from("signals")
        .update({ fill_confidence: verdict })
        .eq("id", r.id);
      if (upErr) throw new Error(`signals update ${r.id}: ${upErr.message}`);
    } else {
      sql.push(`update public.signals set fill_confidence = '${verdict}' where id = ${r.id};`);
    }
    updated++;
  }

  console.log(
    `backfill: ${rows?.length ?? 0} rows scanned, ${updated} ${canWrite ? "updated" : "to update"}, ${skipped} left null (no archived bars)`
  );
  if (!canWrite && sql.length) {
    console.log("\n-- SUPABASE_KEY not set: paste this into the Supabase SQL editor --");
    for (const line of sql) console.log(line);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
