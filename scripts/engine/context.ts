/* Market-context daily table (context_daily): free regime enrichment.
   Daily closes for VIX (^VIX), the dollar index (DX-Y.NYB) and the 10y
   yield (^TNX), keyed by NY date. Fetched through the hardened Yahoo
   helper once per NY day — on the first run of a day the table has no row
   for that date yet, so the engine upserts the trailing ~90 days; that
   same sweep finalizes yesterday's provisional close. Failures are
   non-fatal by contract (the caller wraps and adds a heartbeat note).

   vix_bucket rule (documented once, used for signals AND shadows):
   for a signal on NY date D, take the LAST context row strictly before D
   (no lookahead — D's own close isn't known at entry time) and compare its
   VIX against the median of the trailing 20 rows ending there:
   above the median → "high", else "low"; null with under 20 rows. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChartBySymbol, rawBars } from "@/lib/data/yahoo";
import { nyMeta } from "@/lib/time/ny";

export const CONTEXT_SYMBOLS: Record<"vix" | "dxy" | "tnx", string> = {
  vix: "^VIX",
  dxy: "DX-Y.NYB",
  tnx: "^TNX",
};

export interface ContextRow {
  date_key: string;
  vix: number | null;
  dxy: number | null;
  tnx: number | null;
}

async function dailyCloses(vendorSymbol: string, range: string): Promise<Map<string, number>> {
  return fetchChartBySymbol(vendorSymbol, "1d", range, (result) => {
    const out = new Map<string, number>();
    for (const b of rawBars(result))
      if (Number.isFinite(b.close)) out.set(nyMeta(b.time).dateKey, b.close);
    if (!out.size) throw new Error(`no daily closes for ${vendorSymbol}`);
    return out;
  });
}

/** Build merged context rows for the given range (default 3mo). */
export async function buildContextRows(range = "3mo"): Promise<ContextRow[]> {
  const [vix, dxy, tnx] = await Promise.all([
    dailyCloses(CONTEXT_SYMBOLS.vix, range),
    dailyCloses(CONTEXT_SYMBOLS.dxy, range).catch(() => new Map<string, number>()),
    dailyCloses(CONTEXT_SYMBOLS.tnx, range).catch(() => new Map<string, number>()),
  ]);
  const dates = [...new Set([...vix.keys(), ...dxy.keys(), ...tnx.keys()])].sort();
  return dates.map((date_key) => ({
    date_key,
    vix: vix.get(date_key) ?? null,
    dxy: dxy.get(date_key) ?? null,
    tnx: tnx.get(date_key) ?? null,
  }));
}

/** Once per NY day: if today's row is missing, upsert the trailing ~90 days.
    Returns the number of rows upserted, or 0 when already current. */
export async function updateContextDaily(supabase: SupabaseClient, nowSec: number): Promise<number> {
  const today = nyMeta(nowSec).dateKey;
  const { data, error } = await supabase
    .from("context_daily")
    .select("date_key")
    .eq("date_key", today)
    .limit(1);
  if (error) throw new Error(`context_daily read: ${error.message}`);
  if (data?.length) return 0;
  const rows = await buildContextRows("3mo");
  const stamped = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error: upErr } = await supabase
    .from("context_daily")
    .upsert(stamped, { onConflict: "date_key" });
  if (upErr) throw new Error(`context_daily upsert: ${upErr.message}`);
  return stamped.length;
}

export async function loadContextRows(supabase: SupabaseClient): Promise<ContextRow[]> {
  const { data, error } = await supabase
    .from("context_daily")
    .select("date_key, vix, dxy, tnx")
    .order("date_key", { ascending: true });
  if (error) throw new Error(`context_daily read: ${error.message}`);
  return (data ?? []).map((r) => ({
    date_key: String(r.date_key),
    vix: r.vix === null ? null : Number(r.vix),
    dxy: r.dxy === null ? null : Number(r.dxy),
    tnx: r.tnx === null ? null : Number(r.tnx),
  }));
}

const VIX_MEDIAN_WINDOW = 20;

/** low | high vs the trailing 20-day VIX median, prior-day data only. */
export function vixBucketFor(rows: ContextRow[], dateKeyNy: string): "low" | "high" | null {
  const withVix = rows.filter((r) => r.vix !== null);
  let idx = -1;
  for (let i = withVix.length - 1; i >= 0; i--)
    if (withVix[i].date_key < dateKeyNy) {
      idx = i;
      break;
    }
  if (idx < VIX_MEDIAN_WINDOW - 1) return null;
  const window = withVix.slice(idx - VIX_MEDIAN_WINDOW + 1, idx + 1).map((r) => r.vix as number);
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return (withVix[idx].vix as number) > median ? "high" : "low";
}
