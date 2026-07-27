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

/* The newest date the context sweep could possibly have: ^VIX, DX-Y.NYB and
   ^TNX publish DAILY closes, so today's row does not exist until after today's
   close. Asking for today's row before then can never be satisfied.

   That was the bug: the guard below was `.eq("date_key", today)`, so it never
   latched during the morning and every 15-minute engine pass re-fetched three
   symbols × three months from Yahoo and re-upserted ~90 rows. Confirmed in the
   data — both Saturday 2026-07-25 runs re-swept although the newest row was
   2026-07-24. Anchor on the last COMPLETED trading day instead. */
export function lastCompletedTradingDay(nowSec: number): string {
  // Before the 16:00 ET cash close, today's daily bar is not final yet.
  const m = nyMeta(nowSec);
  let sec = m.minutes >= 16 * 60 ? nowSec : nowSec - 86400;
  for (let i = 0; i < 10; i++) {
    const day = nyMeta(sec);
    if (day.weekday !== "Sat" && day.weekday !== "Sun") return day.dateKey;
    sec -= 86400;
  }
  return nyMeta(sec).dateKey;
}

/** Once per NY day: if the sweep is behind the last completed trading day,
    upsert the trailing ~90 days. Returns rows upserted, or 0 when current. */
export async function updateContextDaily(supabase: SupabaseClient, nowSec: number): Promise<number> {
  const target = lastCompletedTradingDay(nowSec);
  const { data, error } = await supabase
    .from("context_daily")
    .select("date_key")
    .order("date_key", { ascending: false })
    .limit(1);
  if (error) throw new Error(`context_daily read: ${error.message}`);
  const newest = data?.[0]?.date_key ?? null;
  if (newest !== null && newest >= target) return 0;
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
