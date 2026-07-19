/* Backtest report for the live tier configuration (scripts/engine/tiers.ts)
   over the trailing 60 days of delayed Yahoo data.
   Run with: npx tsx scripts/engine/report.ts */

import type { Bar } from "@/lib/types";
import { nyMeta } from "@/lib/time/ny";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES } from "@/lib/market/contracts";
import { fetchYahooBars } from "./data";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "./tiers";

async function main() {
  const [mes, mnq] = await Promise.all([fetchYahooBars("MES"), fetchYahooBars("MNQ")]);
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

  console.table(
    runs.map(({ stream, res }) => ({
      tier: stream.tier,
      stream: `${stream.label} ${stream.symbols.join("+")}`,
      trades: res.metrics.trades,
      perDay: +(res.metrics.trades / Math.max(1, res.sessions)).toFixed(2),
      winRate: res.metrics.winRate === null ? "—" : `${res.metrics.winRate.toFixed(0)}%`,
      net: `$${res.metrics.net.toFixed(0)}`,
      pf: res.metrics.profitFactor === null ? "—" : res.metrics.profitFactor.toFixed(2),
      maxDD: `$${res.metrics.maxDrawdown.toFixed(0)}`,
    }))
  );

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
    `\nCombined: ${total} signals over ${counts.length} trading days = ${(total / counts.length).toFixed(2)}/day, net $${combinedNet.toFixed(0)}`
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
