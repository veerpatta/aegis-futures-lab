/* Honest monthly tune: expanding-window walk-forward with a held-out month
   and a Monte Carlo drawdown check. Prints the full markdown report to
   stdout — .github/workflows/monthly-tune.yml wraps it into the issue.

   Run with: npx tsx scripts/engine/tune.ts

   Rules (all enforced here, stated in the output):
   - Data: bars_5m archive unioned with the current Yahoo window (Yahoo wins
     on overlap) — the tuning window grows every month. The window actually
     used is printed.
   - Out-of-sample: candidates are searched ONLY on data up to 30 days ago;
     the last 30 days are held out. A candidate is proposed ONLY if it beats
     the incumbent on the held-out month on BOTH profit factor and net, with
     at least 8 OOS trades. "Best candidate overfits; keep incumbent" is a
     successful outcome.
   - Monte Carlo: full-window trade sequences resampled 1,000× with
     replacement (deterministic seed); a candidate whose 95th-percentile max
     drawdown is >25% worse than the incumbent's is rejected even if PF
     improved.
   - Candidate grids exist only for the tier-B RSI streams. Tier A (zone-v5)
     trades ~0.3/day — a parameter grid on so few trades is a curve-fitting
     machine, so the incumbent is replayed for reference only.
   - NOTHING changes automatically: tiers.ts is only ever edited by a human. */

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import type { FeedSymbol } from "@/lib/market/contracts";
import type { ParamValues } from "@/lib/strategies/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { fmtPf, profitFactor as profitFactorOf } from "@/lib/stats";
import { resampleDrawdowns } from "./montecarlo";
import { promotionReport, type ShadowLike } from "./promotion";
import { tierStreams } from "./tiers";
import {
  evaluate,
  loadSeries,
  rsiCandidates,
  MC_RESAMPLES,
  MC_P95_TOLERANCE,
  MIN_OOS_TRADES,
  MIN_TRAIN_TRADES,
  OOS_DAYS,
  type EvalResult,
} from "./tune-core";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0)}`;
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

const line = (label: string, r: EvalResult) =>
  `| ${label} | ${r.trades} | ${money(r.net)} | ${fmtPf(r.pf)} |`;

async function main() {
  const streams = tierStreams();
  const symbols = [...new Set(streams.flatMap((s) => s.symbols))] as FeedSymbol[];
  const bySymbol: Record<string, Bar[]> = {};
  for (const s of symbols) bySymbol[s] = await loadSeries(supabase, s);

  const firstBar = Math.min(...symbols.map((s) => bySymbol[s][0].time));
  const lastBar = Math.max(...symbols.map((s) => bySymbol[s][bySymbol[s].length - 1].time));
  const oosStart = lastBar - OOS_DAYS * 86400;

  const md: string[] = [
    `Expanding-window walk-forward over the bar archive (+ current Yahoo window).`,
    ``,
    `- **Window used:** ${day(firstBar)} → ${day(lastBar)} (${Math.round((lastBar - firstBar) / 86400)} days)`,
    `- **Train:** ${day(firstBar)} → ${day(oosStart)} · **Held-out (OOS):** last ${OOS_DAYS} days`,
    `- A candidate is proposed only if it beats the incumbent OOS on BOTH PF and net with ≥${MIN_OOS_TRADES} OOS trades, and its Monte-Carlo p95 drawdown (${MC_RESAMPLES}× resample, full window) is not >25% worse.`,
    ``,
  ];

  for (const stream of streams) {
    const name = `Tier ${stream.tier} · ${stream.label} ${stream.symbols.join("+")}`;
    const incTrain = evaluate(stream, stream.params, bySymbol, { toTime: oosStart });
    const incOos = evaluate(stream, stream.params, bySymbol, { fromTime: oosStart });
    const incFull = evaluate(stream, stream.params, bySymbol, {});
    const incMc = resampleDrawdowns(incFull.pnls, MC_RESAMPLES);

    md.push(`## ${name}`, ``);

    if (stream.strategyId !== "rsi-reversion") {
      md.push(`| Set | Trades | Net | PF |`, `|---|---:|---:|---:|`);
      md.push(line(`incumbent — train`, incTrain));
      md.push(line(`incumbent — **OOS**`, incOos));
      md.push(
        ``,
        `Incumbent Monte Carlo (full window): median max-DD ${money(incMc.median)}, p95 ${money(incMc.p95)}.`,
        ``,
        `_No candidate grid for this stream: at ~0.3 trades/day a parameter search on this window would be curve-fitting, not tuning. Incumbent replayed for reference._`,
        ``
      );
      continue;
    }

    // Search ONLY on the train window.
    let best: { label: string; params: ParamValues; train: EvalResult } | null = null;
    for (const c of rsiCandidates()) {
      const train = evaluate(stream, c.params, bySymbol, { toTime: oosStart });
      if (train.trades < MIN_TRAIN_TRADES || train.net <= 0) continue;
      if (
        !best ||
        (train.pf ?? Infinity) > (best.train.pf ?? Infinity) ||
        ((train.pf ?? null) === (best.train.pf ?? null) && train.net > best.train.net)
      )
        best = { ...c, train };
    }

    const incumbentLabel = `os${stream.params.oversold}/ob${stream.params.overbought}/t${stream.params.targetR}R`;
    if (!best || best.label === incumbentLabel) {
      md.push(`| Set | Trades | Net | PF |`, `|---|---:|---:|---:|`);
      md.push(line(`incumbent — train`, incTrain));
      md.push(line(`incumbent — **OOS**`, incOos));
      md.push(
        ``,
        `Incumbent Monte Carlo (full window): median max-DD ${money(incMc.median)}, p95 ${money(incMc.p95)}.`,
        ``,
        `_Candidate search: no in-sample candidate beat the incumbent — **keep incumbent**._`,
        ``
      );
      continue;
    }

    const candOos = evaluate(stream, best.params, bySymbol, { fromTime: oosStart });
    const candFull = evaluate(stream, best.params, bySymbol, {});
    const candMc = resampleDrawdowns(candFull.pnls, MC_RESAMPLES);
    md.push(`| Set | Trades | Net | PF |`, `|---|---:|---:|---:|`);
    md.push(line(`incumbent — train`, incTrain));
    md.push(line(`incumbent — **OOS**`, incOos));
    md.push(line(`candidate ${best.label} — train`, best.train));
    md.push(line(`candidate ${best.label} — **OOS**`, candOos));
    md.push(
      ``,
      `Monte Carlo (full window, ${MC_RESAMPLES}× resample): incumbent median max-DD ${money(incMc.median)} / p95 ${money(incMc.p95)} · candidate median ${money(candMc.median)} / p95 ${money(candMc.p95)}.`,
      ``
    );

    const oosBeats =
      candOos.trades >= MIN_OOS_TRADES &&
      (candOos.pf ?? -1) > (incOos.pf ?? -1) &&
      candOos.net > incOos.net;
    const mcOk = candMc.p95 <= incMc.p95 * MC_P95_TOLERANCE;

    if (!oosBeats)
      md.push(
        `**Verdict: best in-sample candidate fails the held-out month — it overfits; keep incumbent.** (needs ≥${MIN_OOS_TRADES} OOS trades and better OOS PF *and* net)`,
        ``
      );
    else if (!mcOk)
      md.push(
        `**Verdict: candidate beats OOS but its p95 drawdown is >25% worse (${money(candMc.p95)} vs ${money(incMc.p95)}) — rejected on tail risk; keep incumbent.**`,
        ``
      );
    else
      md.push(
        `**Verdict: candidate \`${best.label}\` survives OOS and Monte Carlo — worth a human look.** Edit scripts/engine/tiers.ts by hand if adopting.`,
        ``
      );
  }

  // VIX-bucket split over live signals — judged only at ≥10 per bucket.
  try {
    const { data, error } = await supabase.from("signals").select("pnl_usd, vix_bucket");
    if (error) throw new Error(error.message);
    const pnlsFor = (bucket: string) =>
      (data ?? [])
        .filter((r) => r.vix_bucket === bucket && r.pnl_usd !== null)
        .map((r) => Number(r.pnl_usd));
    const lowN = (data ?? []).filter((r) => r.vix_bucket === "low").length;
    const highN = (data ?? []).filter((r) => r.vix_bucket === "high").length;
    md.push(`## VIX-bucket split (live signals, all-time)`, ``);
    if (lowN >= 10 && highN >= 10) {
      const low = pnlsFor("low");
      const high = pnlsFor("high");
      md.push(
        `low ${lowN} signals · net ${money(low.reduce((a, v) => a + v, 0))} · PF ${fmtPf(profitFactorOf(low))}`,
        ``,
        `high ${highN} signals · net ${money(high.reduce((a, v) => a + v, 0))} · PF ${fmtPf(profitFactorOf(high))}`,
        ``
      );
    } else md.push(`Collecting (low ${lowN} / high ${highN} — judged at ≥10 each).`, ``);
  } catch (e) {
    md.push(`_VIX split unavailable: ${e instanceof Error ? e.message : e}_`, ``);
  }

  // Shadow-audition scoreboard, same checklist as the weekly digest.
  try {
    const { data, error } = await supabase
      .from("shadow_signals")
      .select("strategy, symbol, status, pnl_usd, regime, fill_confidence");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (ShadowLike & { strategy: string; symbol: string })[];
    const keys = [...new Set(rows.map((r) => `${r.strategy}|${r.symbol}`))].sort();
    md.push(`## Shadow auditions (not signals)`, ``);
    if (!keys.length) md.push(`No shadow rows yet.`, ``);
    else {
      md.push(
        `| Stream | Closed | Net | PF | Checklist | Promotable |`,
        `|---|---:|---:|---:|---|---|`
      );
      for (const key of keys) {
        const [strategy, symbol] = key.split("|");
        const r = promotionReport(rows.filter((x) => x.strategy === strategy && x.symbol === symbol));
        md.push(
          `| ${strategy} / ${symbol} | ${r.closed} | ${money(r.net)} | ${fmtPf(r.pf)} | ${r.checklist
            .map((c) => `${c.pass ? "✅" : "❌"} ${c.label}`)
            .join("<br>")} | ${r.promotable ? "**YES**" : "no"} |`
        );
      }
      md.push(``);
    }
  } catch (e) {
    md.push(`_Shadow scoreboard unavailable: ${e instanceof Error ? e.message : e}_`, ``);
  }

  md.push(
    `---`,
    ``,
    `**No automatic change is made.** \`tiers.ts\` is only ever edited by a human commit. "Keep incumbent" is a successful outcome.`
  );
  console.log(md.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
