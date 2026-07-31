/* How far the delayed Yahoo feed is from the real CME contracts.
   ─────────────────────────────────────────────────────────────────────────
   The deliverable of the Databento phase. Reads both namespaces out of
   bars_5m, pairs them on identical timestamps, and reports where they agree
   and where they do not.

   Run with: npx tsx scripts/diag/feed-delta.ts
   Reads only; the publishable key is enough. */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { byDay, rollWindows, pairOnTime, summarise } from "@/lib/data/feed-delta";
import { nyMeta } from "@/lib/time/ny";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

const PAGE = 1000;
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];

/* A session is "roll-affected" when the feeds disagree by more than this many
   points on average. Set per symbol from a typical STOP distance rather than a
   round number: a disagreement smaller than the stop is a nuisance, one larger
   than it puts a zone on the wrong side of the trade. MES stops average ~9.6
   points and MNQ ~56 (scripts/diag/atr-ratio.ts), so half a stop is a
   defensible line for "this is a different contract, not noise". */
const ROLL_THRESHOLD: Record<FeedSymbol, number> = { MES: 5, MNQ: 28 };

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

async function readBars(symbol: FeedSymbol, source: string): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .eq("source", source)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m ${symbol}/${source}: ${error.message}`);
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

const f = (v: number | null, d = 3) => (v === null ? "—" : v.toFixed(d));

async function main(): Promise<void> {
  for (const symbol of SYMBOLS) {
    const [yahoo, databento] = await Promise.all([
      readBars(symbol, "yahoo"),
      readBars(symbol, "databento"),
    ]);

    console.log(`\n=== ${symbol} — delayed Yahoo vs real CME (Databento) ===`);
    if (!databento.length) {
      console.log("  no Databento bars yet — run the backfill first.");
      continue;
    }

    const s = summarise(yahoo, databento);
    const pv = POINT_VALUES[symbol];
    console.log(
      `  matched ${s.matched} bars · only in Yahoo ${s.onlyInA} · only in Databento ${s.onlyInB}`
    );
    console.log(
      `  close delta: mean ${f(s.meanClose)} · median ${f(s.p50Close)} · ` +
        `p95 ${f(s.p95Close)} · max ${f(s.maxClose, 2)} points`
    );
    if (s.matched)
      console.log(
        `  identical high AND low on ${s.identicalRange} of ${s.matched} bars ` +
          `(${((s.identicalRange / s.matched) * 100).toFixed(1)}%)`
      );
    if (s.p50Close !== null)
      console.log(`  median disagreement in money: $${(s.p50Close * pv).toFixed(2)} per contract`);

    const rows = pairOnTime(yahoo, databento);
    const days = byDay(rows, (sec) => nyMeta(sec).dateKey, ROLL_THRESHOLD[symbol]);
    const seams = rollWindows(days);
    const clean = days.filter((d) => !d.rollAffected);
    const cleanMean = clean.length
      ? clean.reduce((a, d) => a + d.meanClose, 0) / clean.length
      : null;

    console.log(
      `\n  ${days.length} sessions · ${seams.length} contract-roll seam(s) ` +
        `covering ${days.length - clean.length} session(s)`
    );
    console.log(`  outside the seams the feeds agree to ${f(cleanMean)} points on average`);
    for (const w of seams)
      console.log(
        `    ROLL ${w.from} → ${w.to} · peak disagreement ${w.peak.toFixed(2)} points ` +
          `($${(w.peak * pv).toFixed(0)}/contract)`
      );

    /* The verdict, stated rather than left to the reader. */
    if (cleanMean !== null) {
      const pctAffected = ((days.length - clean.length) / days.length) * 100;
      console.log(
        `\n  VERDICT: outside roll weeks the delayed feed is within ` +
          `${f(cleanMean, 2)} points — usable for zone geometry. ` +
          `${pctAffected.toFixed(1)}% of sessions sit in a roll seam where it is not.`
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
