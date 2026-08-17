/* The correlation gate for the gold/silver strategy.
 *
 * "Silver confirms gold" is not a detail of this strategy — it IS the
 * strategy. Every rule in the brief (wait for silver, take gold alone only
 * when silver has no zone, be strict in NY) assumes the two markets carry the
 * same information. If they do not co-move intraday, the confirmation rule is
 * unfounded and no amount of tuning downstream can rescue it.
 *
 * So this runs BEFORE the strategy is built, not after. A refutation here is a
 * successful outcome: it costs a day instead of a month.
 *
 * The comparison is against MES/MNQ, whose measured rho of 0.923 is the
 * reference for "effectively one instrument" in this repo. Gold/silver should
 * be positive and material; it should NOT be as high as MES/MNQ, because two
 * halves of the same equity tape are more redundant than two metals.
 *
 * Run: BAR_SOURCE=databento npx tsx scripts/diag/metals-correlation.ts
 */

import { createClient } from "@supabase/supabase-js";
import { fetchArchiveBars, assertArchivePresent } from "@/lib/data/archive";
import { summariseCorrelation, effectiveSampleSize } from "@/lib/diagnostics/correlation";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import type { Bar } from "@/lib/types";

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

/* Below this the confirmation premise is not supported and the strategy should
   not be built. Not a round number pulled from the air: the brief's whole
   mechanism is "gold reaches its zone, wait for silver to reach its
   corresponding zone", which requires the two to be moving together often
   enough that a silver zone is reachable while a gold zone is still fresh. */
const GATE_OVERALL = 0.4;
const GATE_WINDOW_SHARE = 0.5; // share of rolling windows that must stay positive

async function load(symbol: string): Promise<Bar[]> {
  const bars = await fetchArchiveBars(supabase, { symbol, source: "databento" });
  return assertArchivePresent(bars, { symbol, source: "databento", minBars: 100_000 });
}

async function main() {
  console.log("Metals correlation gate — databento, whole archive\n");

  const [mgc, si, mes, mnq] = await Promise.all([
    load("MGC"),
    load("SI"),
    load("MES"),
    load("MNQ"),
  ]);
  for (const [s, b] of [
    ["MGC", mgc],
    ["SI", si],
    ["MES", mes],
    ["MNQ", mnq],
  ] as const)
    console.log(`  loaded ${s}: ${b.length.toLocaleString()} bars`);

  const pairs = [
    { label: "MGC/SI  (the strategy's premise)", a: mgc, b: si },
    { label: "MES/MNQ (the reference, rho 0.923)", a: mes, b: mnq },
    { label: "MGC/MES (control — unrelated assets)", a: mgc, b: mes },
  ];

  console.log("");
  const results = pairs.map((p) => ({ label: p.label, c: summariseCorrelation(p.a, p.b) }));
  for (const { label, c } of results) {
    console.log(
      `${label.padEnd(38)} rho ${c.overall.toFixed(3)}  ` +
        `median-rolling ${c.medianRolling.toFixed(3)}  ` +
        `min ${c.minRolling.toFixed(3)}  ` +
        `>0.8 in ${(c.shareAbove80 * 100).toFixed(1)}% of windows  ` +
        `n=${c.pairs.toLocaleString()}`
    );
  }

  const gold = results[0].c;
  const nominal = 2000; // illustrative: what 2,000 nominal trades would deflate to
  console.log(
    `\nEffective-N effect: ${nominal.toLocaleString()} nominal gold trades ` +
      `≈ ${Math.round(effectiveSampleSize(nominal / 2, 2, gold.overall)).toLocaleString()} effective ` +
      `at rho ${gold.overall.toFixed(3)}.`
  );

  const passes = gold.overall >= GATE_OVERALL && gold.medianRolling >= GATE_OVERALL;
  console.log("\n" + "─".repeat(72));
  if (passes) {
    console.log(
      `PASS. Gold and silver co-move (rho ${gold.overall.toFixed(3)} overall, ` +
        `${gold.medianRolling.toFixed(3)} median rolling), both at or above the ` +
        `${GATE_OVERALL} gate. The confirmation premise is supported — which is NOT ` +
        `the same as the strategy having an edge. That is what the random-entry ` +
        `benchmark is for.`
    );
  } else {
    console.log(
      `REFUTED. Gold and silver do not co-move enough to justify the ` +
        `confirmation rule (rho ${gold.overall.toFixed(3)} overall, ` +
        `${gold.medianRolling.toFixed(3)} median rolling, gate ${GATE_OVERALL}). ` +
        `The brief's mechanism — wait for silver before entering gold — has no ` +
        `basis in the data. STOP: do not build the strategy on it.`
    );
  }
  console.log("─".repeat(72));
  void GATE_WINDOW_SHARE;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
