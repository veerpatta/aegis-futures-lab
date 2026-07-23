/* Backtest report for the live tier configuration (scripts/engine/tiers.ts)
   — the numbers the tiers were tuned on, reproducible on demand.

   Run with: npx tsx scripts/engine/report.ts [--archive] [--markdown]

     (no flags)   trailing 60 days of delayed Yahoo 5m data, console tables
     --archive    longest window available: full bars_5m archive unioned
                  with the current Yahoo window (Yahoo wins on overlap)
     --markdown   emit a GitHub-flavored markdown table instead of
                  console.table — used by .github/workflows/monthly-tune.yml

   Read-only: the archive read uses the publishable key (public SELECT). */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fetchYahooBars } from "./data";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "./tiers";

const useArchive = process.argv.includes("--archive");
const asMarkdown = process.argv.includes("--markdown");

const PAGE = 1000;

async function archiveAllBars(symbol: FeedSymbol): Promise<Bar[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL || SUPABASE_URL,
    process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } }
  );
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

async function loadSeries(symbol: FeedSymbol): Promise<Bar[]> {
  if (!useArchive) return fetchYahooBars(symbol);
  const [archive, yahoo] = await Promise.all([
    archiveAllBars(symbol),
    fetchYahooBars(symbol).catch(() => [] as Bar[]),
  ]);
  const byTime = new Map(archive.map((b) => [b.time, b]));
  for (const b of yahoo) byTime.set(b.time, b); // Yahoo wins on overlap
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (!bars.length) throw new Error(`No bars for ${symbol} from archive or Yahoo`);
  return bars;
}

async function main() {
  const [mes, mnq] = await Promise.all([loadSeries("MES"), loadSeries("MNQ")]);
  const bySymbol: Record<string, Bar[]> = { MES: mes, MNQ: mnq };

  const runs = tierStreams().map((stream) => ({
    stream,
    res: executeRun({
      strategyId: stream.strategyId,
      params: stream.params,
      series: Object.fromEntries(stream.symbols.map((s) => [s, bySymbol[s]])),
      execution: { ...EXECUTION, fillModel: stream.fillModel },
      locks: stream.locks,
      startingCapital: STARTING_CAPITAL,
      sessionExitMinute: SESSION_EXIT_MINUTE,
      pointValues: POINT_VALUES,
    }),
  }));

  const rows = runs.map(({ stream, res }) => ({
    tier: stream.tier,
    stream: `${stream.label} ${stream.symbols.join("+")}`,
    trades: res.metrics.trades,
    perDay: +(res.metrics.trades / Math.max(1, res.sessions)).toFixed(2),
    winRate: res.metrics.winRate === null ? "—" : `${res.metrics.winRate.toFixed(0)}%`,
    net: `$${res.metrics.net.toFixed(0)}`,
    pf: res.metrics.profitFactor === null ? "—" : res.metrics.profitFactor.toFixed(2),
    maxDD: `$${res.metrics.maxDrawdown.toFixed(0)}`,
  }));

  const windowNote = `window: ${new Date(mes[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(
    mes[mes.length - 1].time * 1000
  ).toISOString().slice(0, 10)} (${useArchive ? "archive + Yahoo" : "Yahoo 60d"})`;

  if (asMarkdown) {
    console.log(`_${windowNote}_`);
    console.log("");
    console.log("| Tier | Stream | Trades | Trades/day | Win rate | Net | PF | Max DD |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const r of rows)
      console.log(
        `| ${r.tier} | ${r.stream} | ${r.trades} | ${r.perDay} | ${r.winRate} | ${r.net} | ${r.pf} | ${r.maxDD} |`
      );
  } else {
    console.log(windowNote);
    console.table(rows);
  }

  const byDay = new Map<string, number>();
  let total = 0;
  for (const { res } of runs)
    for (const t of res.trades) {
      const day = nyMeta(t.entryTime).dateKey;
      byDay.set(day, (byDay.get(day) || 0) + 1);
      total++;
    }
  const weekdays = new Set<string>();
  for (const b of mes) {
    const m = nyMeta(b.time);
    if (m.minutes >= 570 && m.minutes < 925) weekdays.add(m.dateKey);
  }
  const counts = [...weekdays].map((d) => byDay.get(d) || 0);
  const combinedNet = runs.reduce((a, r) => a + r.res.metrics.net, 0);
  console.log(
    `\nCombined: ${total} signals over ${counts.length} trading days = ${(total / Math.max(1, counts.length)).toFixed(2)}/day, net $${combinedNet.toFixed(0)}`
  );
  console.log(
    `Days with ≥1: ${counts.filter((c) => c >= 1).length}/${counts.length}, ` +
      `≥2: ${counts.filter((c) => c >= 2).length}, ≥3: ${counts.filter((c) => c >= 3).length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
