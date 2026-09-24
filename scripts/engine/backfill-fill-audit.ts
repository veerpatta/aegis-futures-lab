/* One-off backfill: classify fill_confidence for existing signal rows from
   bars_5m history. Rows whose bars aren't archived stay null. Idempotent —
   safe to re-run; the live engine re-stamps anything inside its 7-day
   lookback anyway, so this mainly covers older rows.

   Run with:  npx tsx scripts/engine/backfill-fill-audit.ts

   Requires DATABASE_URL for the Neon server connection. */

import { createClient } from "@/lib/neon/server";
import type { Bar } from "@/lib/types";
import { auditFill, type FillConfidence } from "./fill-audit";
import { EXECUTION } from "./tiers";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";

const supabase = createClient();

const PAGE = 1000;

async function allBars(symbol: string): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close")
      .eq("symbol", symbol)
      .eq("source", DEFAULT_BAR_SOURCE)
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
    const { error: upErr } = await supabase
      .from("signals")
      .update({ fill_confidence: verdict })
      .eq("id", r.id);
    if (upErr) throw new Error(`signals update ${r.id}: ${upErr.message}`);
    updated++;
  }

  console.log(
    `backfill: ${rows?.length ?? 0} rows scanned, ${updated} updated, ${skipped} left null (no archived bars)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
