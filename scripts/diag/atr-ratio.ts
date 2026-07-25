/* Measured DOLLAR volatility ratio between MNQ and MES — the derivation behind
   the per-symbol risk profile in scripts/engine/tiers.ts (item 2.3).

   The brief's "MNQ is 4× the point volatility of MES" is point-value arithmetic
   ($5 vs $2 per point), not a measurement. What the discipline locks actually
   need is the ratio of ATR expressed in DOLLARS per contract, because that is
   what a fixed $160 maxRisk and $250 daily-loss lock are denominated in.

   Read-only. Run with: npx tsx scripts/diag/atr-ratio.ts */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { atr } from "@/lib/indicators/index";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { inNySession } from "@/lib/time/ny";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

const PAGE = 1000;
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const ATR_LEN = 14; // same length rsi-reversion uses

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

async function allBars(symbol: FeedSymbol): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
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

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const rows: Record<string, string | number>[] = [];
  const dollarAtr: Record<string, number> = {};
  for (const symbol of SYMBOLS) {
    const bars = await allBars(symbol);
    const rth = bars.filter((b) => inNySession(b.time));
    const point = POINT_VALUES[symbol];
    // ATR on RTH bars only — the locks bite during the session the bot trades.
    const series = atr(rth, ATR_LEN).filter((v): v is number => v !== null && v > 0);
    const dollars = series.map((v) => v * point);
    dollarAtr[symbol] = mean(dollars);
    rows.push({
      symbol,
      "point value": `$${point}`,
      bars: rth.length,
      "mean ATR (pts)": +mean(series).toFixed(2),
      "median ATR (pts)": +median(series).toFixed(2),
      "mean ATR ($/contract)": +mean(dollars).toFixed(2),
      "median ATR ($/contract)": +median(dollars).toFixed(2),
    });
  }
  console.table(rows);
  const ratio = dollarAtr.MNQ / dollarAtr.MES;
  console.log(`\nMNQ / MES dollar-ATR ratio: ${ratio.toFixed(3)}`);
  console.log(`  point-value ratio (the brief's "4×" premise): ${(5 / 2).toFixed(2)} — MES $5 vs MNQ $2`);
  console.log(
    `\nIf MES keeps maxRisk $160 / dailyLoss $250, the equally-biting MNQ values are ` +
      `maxRisk $${Math.round(160 * ratio)} / dailyLoss $${Math.round(250 * ratio)}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
