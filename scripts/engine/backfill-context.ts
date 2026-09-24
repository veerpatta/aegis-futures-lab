/* One-off backfill for the market-context table and the vix_bucket tags.

   Run with:  npx tsx scripts/engine/backfill-context.ts

   1. Fetches a full year of daily ^VIX / DX-Y.NYB / ^TNX closes (covers the
      bar archive's whole span with margin) and upserts context_daily.
   2. Retro-tags vix_bucket on existing signals AND shadow_signals rows
      using the same no-lookahead rule as the live engine (context.ts).

   Requires DATABASE_URL for the Neon server connection. Idempotent. */

import { createClient } from "@/lib/neon/server";
import { nyMeta } from "@/lib/time/ny";
import { buildContextRows, vixBucketFor } from "./context";

const supabase = createClient();

async function main() {
  const rows = await buildContextRows("1y");
  console.log(`context: ${rows.length} daily rows fetched (${rows[0]?.date_key} → ${rows[rows.length - 1]?.date_key})`);

  const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  for (let i = 0; i < stamped.length; i += 500) {
    const { error } = await supabase
      .from("context_daily")
      .upsert(stamped.slice(i, i + 500), { onConflict: "date_key" });
    if (error) throw new Error(`context_daily upsert: ${error.message}`);
  }

  // Retro-tag both tables with the same rule the engine uses.
  for (const table of ["signals", "shadow_signals"] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("id, signal_ts, vix_bucket")
      .order("signal_ts", { ascending: true });
    if (error) throw new Error(`${table} read: ${error.message}`);
    let updated = 0;
    for (const r of data ?? []) {
      const dateKey = nyMeta(Math.floor(new Date(r.signal_ts as string).getTime() / 1000)).dateKey;
      const bucket = vixBucketFor(rows, dateKey);
      if (bucket === null || bucket === r.vix_bucket) continue;
      const { error: upErr } = await supabase
        .from(table)
        .update({ vix_bucket: bucket })
        .eq("id", r.id);
      if (upErr) throw new Error(`${table} update ${r.id}: ${upErr.message}`);
      updated++;
    }
    console.log(`${table}: ${updated} rows tagged`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
