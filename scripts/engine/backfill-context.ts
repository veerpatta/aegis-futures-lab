/* One-off backfill for the market-context table and the vix_bucket tags.

   Run with:  npx tsx scripts/engine/backfill-context.ts

   1. Fetches a full year of daily ^VIX / DX-Y.NYB / ^TNX closes (covers the
      bar archive's whole span with margin) and upserts context_daily.
   2. Retro-tags vix_bucket on existing signals AND shadow_signals rows
      using the same no-lookahead rule as the live engine (context.ts).

   Writes need the service-role key. With SUPABASE_KEY set, rows are
   written directly; without it the script PRINTS the SQL to paste into
   the Supabase SQL editor. Idempotent either way. */

import { createClient } from "@supabase/supabase-js";
import { nyMeta } from "@/lib/time/ny";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { buildContextRows, vixBucketFor } from "./context";

const url = process.env.SUPABASE_URL || SUPABASE_URL;
const key = process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY;
const canWrite = Boolean(process.env.SUPABASE_KEY);
const supabase = createClient(url, key, { auth: { persistSession: false } });

const sqlNum = (v: number | null) => (v === null ? "null" : String(v));

async function main() {
  const rows = await buildContextRows("1y");
  console.log(`context: ${rows.length} daily rows fetched (${rows[0]?.date_key} → ${rows[rows.length - 1]?.date_key})`);

  const sql: string[] = [];
  if (canWrite) {
    const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    for (let i = 0; i < stamped.length; i += 500) {
      const { error } = await supabase
        .from("context_daily")
        .upsert(stamped.slice(i, i + 500), { onConflict: "date_key" });
      if (error) throw new Error(`context_daily upsert: ${error.message}`);
    }
  } else {
    sql.push(
      `insert into public.context_daily (date_key, vix, dxy, tnx) values`,
      rows
        .map((r) => `  ('${r.date_key}', ${sqlNum(r.vix)}, ${sqlNum(r.dxy)}, ${sqlNum(r.tnx)})`)
        .join(",\n") +
        `\non conflict (date_key) do update set vix = excluded.vix, dxy = excluded.dxy, tnx = excluded.tnx, updated_at = now();`
    );
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
      if (canWrite) {
        const { error: upErr } = await supabase
          .from(table)
          .update({ vix_bucket: bucket })
          .eq("id", r.id);
        if (upErr) throw new Error(`${table} update ${r.id}: ${upErr.message}`);
      } else {
        sql.push(`update public.${table} set vix_bucket = '${bucket}' where id = ${r.id};`);
      }
      updated++;
    }
    console.log(`${table}: ${updated} rows ${canWrite ? "tagged" : "to tag"}`);
  }

  if (!canWrite && sql.length) {
    console.log("\n-- SUPABASE_KEY not set: paste this into the Supabase SQL editor --");
    console.log(sql.join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
