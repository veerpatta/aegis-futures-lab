/* Weekly research — Hypothesis 3: COST SENSITIVITY.

   WHAT IT ASKS
   ────────────
   Does the live edge survive worse fills? "A strategy that dies at 2x was
   never an edge" — so re-run the exact live config (unchanged params) at 2x
   and 3x EXECUTION.slippage and see what happens to PF.

   HYPOTHESIS (falsifiable)
   ─────────────────────────
   H3: "The live streams' edge is fragile to slippage — PF collapses to
   <=1.0 at 2x the modeled slippage."
   Framed so either direction is informative: if PF holds above 1 at 2x/3x,
   H3 is REFUTED (the edge is not merely a cost artifact of an optimistic
   fill assumption). If PF collapses at 2x, H3 SURVIVES — which is itself
   the useful finding (the edge is cost-fragile and shouldn't be trusted at
   real-world slippage).

   METHOD
   ──────
   Same live config (scripts/engine/tiers.ts, unchanged) re-run with
   execution.slippage multiplied by 1x/2x/3x — nothing else changes. This is
   a direct re-run (entries are DERIVED, not replayed) because slippage feeds
   into the entry fill price itself (lib/backtest/engine.ts: entry = open ±
   slippage for nextOpen, limit ± slippage for resting-limit), which can
   change which bar fills, whether invalidFill trips, and downstream stops —
   a replay-from-fixed-entry approach (as in management-replay.ts) would
   under-state the effect for exactly this reason.
   Measured over the full day-aligned archive (like tier-a-baseline.ts) AND
   across the same 11 one-day-shift windows tier-a-baseline.ts uses, so a
   result isn't reported on one arbitrary window — consistency across shifts
   is the "held out" check here, since there is no parameter being fit to
   train data in this diagnostic (the config is fixed already).
   Doubtful-fill trades are inherent to the funnel (a real gate, `invalidFill`)
   not filtered here — cost sensitivity should see the whole live funnel,
   this is the one diagnostic this week where that gate must stay live.

   REPRODUCE
   ─────────
     npx tsx scripts/diag/cost-sensitivity.ts
   Read-only: no writes, no parameter changes. */

import type { Bar } from "@/lib/types";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "@/scripts/engine/tiers";
import { archiveBars, num, sessionsIn } from "./archive-lib";

const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const MULTS = [1, 2, 3];

function runStream(streamKey: string, full: Record<string, Bar[]>, slipMult: number, window?: { fromTime?: number; toTime?: number }) {
  const stream = tierStreams().find(
    (s) => (s.tier === "A" ? "A" : `B:${s.symbols.join("+")}`) === streamKey
  )!;
  const series = Object.fromEntries(stream.symbols.map((s) => [s, full[s]]));
  return executeRun({
    strategyId: stream.strategyId,
    params: stream.params,
    series,
    execution: {
      ...EXECUTION,
      fillModel: stream.fillModel,
      maxRisk: stream.maxRisk ?? EXECUTION.maxRisk,
      slippage: EXECUTION.slippage * slipMult,
    },
    locks: stream.locks,
    startingCapital: STARTING_CAPITAL,
    sessionExitMinute: SESSION_EXIT_MINUTE,
    pointValues: POINT_VALUES,
    window,
  });
}

async function main() {
  const full: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) full[s] = await archiveBars(s);
  const sessions = sessionsIn(full.MES);
  console.log(
    `archive: ${sessions.length} sessions (${sessions[0]} → ${sessions[sessions.length - 1]}), ` +
      `baseline slippage $${EXECUTION.slippage}/pt`
  );

  const streamIds = ["A", "B:MES", "B:MNQ"];
  const verdicts: Record<string, string> = {};

  for (const streamKey of streamIds) {
    console.log(`\n\n############ stream ${streamKey} — full archive ############`);
    const rows = MULTS.map((mult) => {
      const r = runStream(streamKey, full, mult);
      return {
        slippage: `${mult}x ($${(EXECUTION.slippage * mult).toFixed(2)}/pt)`,
        trades: r.metrics.trades,
        "win%": num(r.metrics.winRate, 1),
        PF: num(r.metrics.profitFactor),
        net: `$${num(r.metrics.net, 0)}`,
        maxDD: `$${num(r.metrics.maxDrawdown, 0)}`,
        invalidFill: r.skipReasons.invalidFill ?? 0,
      };
    });
    console.table(rows);

    const pf1 = Number.isFinite(runStream(streamKey, full, 1).metrics.profitFactor)
      ? runStream(streamKey, full, 1).metrics.profitFactor
      : Infinity;
    const pf2 = runStream(streamKey, full, 2).metrics.profitFactor;
    const pf3 = runStream(streamKey, full, 3).metrics.profitFactor;
    const verdict =
      pf2 <= 1.0
        ? "SURVIVED (H3) — PF collapses to <=1.0 at 2x slippage; edge is cost-fragile"
        : pf3 <= 1.0
          ? "PARTIAL — PF holds at 2x but collapses at 3x"
          : "REFUTED (H3) — PF holds above 1.0 through 3x slippage";
    verdicts[streamKey] = verdict;
    console.log(`stream ${streamKey}: PF 1x=${num(pf1)}, 2x=${num(pf2)}, 3x=${num(pf3)} → ${verdict}`);

    // Robustness: same 11 one-day window shifts tier-a-baseline.ts uses, at 2x
    // slippage only (the interesting stress point), so the verdict isn't one
    // arbitrary archive slice.
    console.log(`\n=== ${streamKey} @ 2x slippage across 11 one-day window shifts ===`);
    const endSec = Math.max(...SYMBOLS.map((s) => full[s][full[s].length - 1].time));
    const shiftRows: Record<string, string | number>[] = [];
    for (let back = 0; back <= 10; back++) {
      const to = endSec - back * 86400;
      const from = to - 60 * 86400;
      if (SYMBOLS.some((s) => !full[s].some((b) => b.time >= from))) continue;
      const r = runStream(streamKey, full, 2, { fromTime: from, toTime: to });
      shiftRows.push({
        "window end": new Date(to * 1000).toISOString().slice(0, 10),
        trades: r.metrics.trades,
        PF: num(r.metrics.profitFactor),
        net: `$${num(r.metrics.net, 0)}`,
      });
    }
    console.table(shiftRows);
    const pfs = shiftRows.map((r) => Number(r.PF)).filter(Number.isFinite);
    console.log(
      pfs.length
        ? `PF range across shifts @ 2x: ${Math.min(...pfs).toFixed(2)}–${Math.max(...pfs).toFixed(2)}`
        : `no finite PF across shifts (all-win or no-loss windows)`
    );
  }

  console.log(`\n\n=== summary ===`);
  console.table(verdicts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
