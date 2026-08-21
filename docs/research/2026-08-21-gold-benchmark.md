# Gold zones, silver confirmed — random-entry benchmark

**Date:** 2026-08-21
**Script:** `scripts/diag/gold-benchmark.ts`
**Data:** Databento GLBX.MDP3 5-minute bars, MGC and SI, 2019-05-06 → 2026-07-29
(506,019 gold bars, 507,549 silver bars)
**Iterations:** 500 per cell · **Mode:** `matchDayCounts` · **Params:** shipped defaults

## Verdict

**Refuted. 0 of 9 judged cells beat matched random entries.**

The full sample sits at the **53.8th percentile** of its own null — the middle of the
distribution, not the wrong end of it. The entry rule carries no information the null
does not already have.

This is the same outcome the three live streams reached in
[Phase 1](2026-07-31-phase1-findings.md) and again on the corrected engine in
[the re-measurement](2026-08-17-remeasurement.md). Gold is now the fourth.

| Cell | Trades | Net | Avg R | Percentile (avg R) | p | Verdict |
|---|---:|---:|---:|---:|---:|---|
| MGC:all | 1,782 | −$19,332 | −0.081 | 53.8 | 0.463 | indistinguishable |
| MGC:2019 | 138 | +$94 | +0.005 | 77.2 | 0.230 | indistinguishable |
| MGC:2020 | 234 | −$785 | −0.025 | 70.4 | 0.297 | indistinguishable |
| MGC:2021 | 215 | +$20 | +0.001 | 74.0 | 0.261 | indistinguishable |
| MGC:2022 | 237 | −$1,992 | −0.063 | 47.4 | 0.527 | indistinguishable |
| MGC:2023 | 210 | −$680 | −0.024 | 69.0 | 0.311 | indistinguishable |
| MGC:2024 | 218 | −$3,879 | −0.133 | 21.4 | 0.786 | indistinguishable |
| MGC:2025 | 261 | −$3,480 | −0.100 | 33.6 | 0.665 | indistinguishable |
| MGC:2026 | 319 | −$7,478 | −0.176 | 15.8 | 0.842 | indistinguishable |

The bar is the 95th percentile. Nothing comes near it. The best cell (2019, 77.2) is
also the smallest — 138 trades — and `verdictFor()` would call it insufficient sample on
its own terms had it been judged alone.

## What this does NOT say

**It is not anti-predictive.** No cell falls below the 5th percentile, so this is not the
mirror-image finding that a fade would work. It is the genuinely uninformative middle.
This distinction matters because the first Phase 1 run made exactly the opposite claim
about tier A and had to withdraw it once impossible fills were removed.

**The correlation premise survived.** `metals-correlation.ts` measured ρ = 0.735 against
a 0.4 gate before this strategy was built, and nothing here refutes that. Gold and silver
do co-move. What fails is the leap from "they co-move" to "silver reaching its zone tells
you something about gold's next 17 points". A true premise does not make the rule built
on it informative.

**The losses are not a costs story.** Gross is −$15,056 against net −$19,332 on the full
sample. Turning costs off leaves it losing. The entries lose before friction, so there is
no version of this with cheaper execution that works.

## Limitation, stated rather than buried

`realisedNRatio` is **0.41–0.49** across every cell: the null completes only about half
the real book's trade count. The draw asks for the right number, but a random entry holds
a 13-point stop and 17-point target and blocks the entries that would have followed it,
while the real book's zone-gated entries are naturally spaced.

The comparison metric is **avg R**, which is per-trade and so is not directly biased by
this. The second-order effect is that a null with fewer trades has a *wider* avg-R
distribution, which makes the 95th percentile *harder* to clear — the test is therefore
conservative against finding an edge, not generous.

That caveat would matter for a marginal result. At 53.8 it does not: no plausible
re-matching of trade counts moves a result from the middle of the null to above its 95th
percentile. Timing matched well independently — `minuteDeviation` is 0.048–0.163.

A follow-up that matched realised counts more tightly would strengthen the report. It
would not change the decision.

## Methodology notes

Two choices in `gold-benchmark.ts` are load-bearing and would silently corrupt the result
if reversed:

1. **The null pool is gold only.** `candidatePool()` walks every symbol in the series it
   is handed, and this strategy is handed two. Left alone it would draw random entries on
   **silver** — a market the real book never trades and `specs.ts` forbids sizing — and
   compare gold against that.

2. **There is no session window.** Tier B's null borrows the strategy's own `rth`/`day`
   window so the null cannot trade hours the strategy could not. Gold has no
   minute-of-day window; it gates on the Globex session (asia/london/ny vs closed), which
   is not expressible as a minute range. The pool is left unbounded and the
   minute-distribution diagnostics are reported above rather than assumed.

The benchmark ran against a strategy the live tier config has never contained, which is
the point: a candidate has to be measurable *before* promotion or the rule that says
"nothing reaches a tier without passing the gate" cannot be obeyed.

## Consequence

- Gold moved from `UNMEASURED` to `REFUTED` in `lib/strategies/registry.ts`. "We have not
  looked yet" and "we looked, and it is a coin flip" are different claims and must not
  share a badge.
- Added to `REFUTED_STREAM_EVIDENCE` so `/diagnostics` shows the gate refusing it, beside
  the three live streams.
- It stays out of `tierStreams()`. Nothing changed about what the engine runs.
- **Do not tune it.** The Phase 1 brief forbids optimising a signal that does not beat a
  coin flip, and that applies here exactly as it applies to the incumbents. The raw
  material for a different idea is still on disk — the correlation holds, the zone
  machinery works, the bars are archived — but it would be a new hypothesis with its own
  pre-registered prediction, not a reparameterisation of this one.

Raw output: `docs/research/gold-random-entry.json`.
