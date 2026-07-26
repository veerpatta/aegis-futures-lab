# Weekly research — 2026-07-26

Three falsifiable hypotheses, each with a diagnostic that could have refuted
it. All three were tested on the day-aligned full `bars_5m` archive (51
sessions, 2026-05-12 → 2026-07-24) and, for H2, the shadow-strategy audition
roster over the same archive. Search was done on a train slice (first ~70%
of sessions by date) and checked against a held-out validation slice; no
in-sample number below is reported as evidence on its own.

**Result: all three hypotheses were refuted for the two live tier streams.**
One narrow, non-live finding survived (a bad hour for a shadow-only
strategy) and is flagged for future audition review, not for a live change.

| # | Hypothesis | Verdict |
|---|---|---|
| H1 | An alternative exit/management rule beats the live fixed-target exit, and the improvement holds out of sample | **REFUTED** (all 3 streams) |
| H2 | A specific NY hour or weekday is reliably bad across streams, and dropping it generalizes | **REFUTED** (combined); insufficient n for either live tier-B stream alone |
| H3 | The live PF is a cost artifact that collapses at 2x/3x slippage | **REFUTED** for B:MES and B:MNQ; **borderline/inconclusive** for tier A (see below) |

---

## H1 — Exit and management replay

**Method.** Entries are fixed (the live tier streams' own trades over the
full archive — 16 for tier A, 62 for B:MES, 56 for B:MNQ, tier-A doubtful
resting-limit fills excluded, n=0 dropped this run). For each trade, bars
after entry are re-walked under 8 alternative management rules (breakeven
after 1R, ATR(14)×2/×3 trailing stop, time stops at 12/24 bars, partial 50%
at 1R with a breakeven runner, and flattening at 15:00/16:00 instead of
15:25), holding entry/stop/side/qty fixed. A baseline replay under "no
change" reproduced the engine's own recorded net exactly for all three
streams (diff $0 for B:MES and B:MNQ; tier A required fixing the replay to
also apply the engine's same-bar "swept" stop-out for resting-limit fills —
after that fix, diff $0 there too). Script: `scripts/diag/management-replay.ts`.

**Refutation test:** does the best-on-train variant also beat the live
baseline on validation?

- **Tier A** (n=16): the 70% split lands almost the whole population in
  validation (2 train / 14 validation trades — tier A's known single-day
  clustering, see `PHASE1-FINDINGS.md`) so train-side selection is
  **insufficient** by construction. On validation (n=14), every variant is
  within a few dollars of the live baseline (net -$192 baseline vs -$180 to
  -$649 for the others) — none improves on it, several are materially worse
  (partial-at-1R: -$649). No variant is worth adopting.
- **B:MES** (train n=44, validation n=18): best on train was "time stop @ 12
  bars" (PF 1.05, net +$118 vs baseline PF 0.84, net -$555). On validation
  that same variant scored PF 4.82, net $1,672 — **below** the live
  baseline's PF 6.02, net $2,198. Train-set winner did not generalize.
- **B:MNQ** (train n=39, validation n=17): best on train was "stop to
  breakeven after 1R" (PF 1.26, net $543 vs baseline PF 1.11, net $286). On
  validation that variant scored PF 1.51, net $307 — again **below** the
  live baseline's PF 1.73, net $592.

Both live tier-B streams show the same shape: whichever variant looks best
on the training slice loses to the do-nothing baseline on the held-out
slice. That is the textbook overfitting signature the brief warned about,
and it is the honest result of actually checking rather than reporting the
train number. **H1 is refuted for all three streams** — none of the eight
management alternatives is a change worth proposing.

At 2x slippage (validation slice) the ranking among variants doesn't
reshuffle for any stream; whichever was best/worst at 1x stays so at 2x.

*Exploratory aside, not evidence*: "time stop @ 12 bars" won B:MES's train
slice and also outperformed B:MNQ's baseline on B:MNQ's validation slice (PF
2.62 vs baseline 1.73). Two coincidental wins across different
stream/slice combinations is not a pre-registered, confirmed pattern — it is
a candidate for next week's queue, tested properly on fresh data, not a
finding to act on now.

---

## H2 — Time-of-day and day-of-week expectancy

**Method.** Per-stream n over one archive is in the tens (tier A: 16). To
reach the hundreds, this script (`scripts/diag/time-of-day-expectancy.ts`)
pools every configured stream over the SAME full archive: tier A, both
tier-B streams, and the three active shadow-audition strategies
(vwap-reversion, orb, bollinger-breakout) × MES/MNQ, at their exact live
configs. `ema-cross` is excluded — retired 2026-07-25 for being genuinely
bad (2 of 28 profitable, net -$2,718); folding it back in would launder a
known-broken stream into a restriction finding. Pooled n = 530 (train 357,
validation 173) across 9 stream/symbol combinations (`orb` fired only 3
times on MES and 0 on MNQ over the whole archive — noted, not filled in).

**Combined, by NY hour-of-entry.** Worst train bucket: hour 4 (04:00 ET),
n=31, expectancy **-$49.09**. Same bucket on validation: n=19, expectancy
**-$0.75** — the effect nearly vanished. Combined validation expectancy WITH
that hour: -$3.89/trade (n=173); WITHOUT it: -$4.27/trade (n=154) — removing
it made validation expectancy *worse*, not better.
**VERDICT: REFUTED.**

**Combined, by NY weekday.** Worst train bucket: Tuesday, n=84, expectancy
**-$32.93**. Same day on validation: n=30, expectancy **+$15.30** — the sign
flipped positive. **VERDICT: REFUTED** (train pattern reversed on held-out
data).

**Live tier-B streams alone.** Every hour bucket for B:MES and B:MNQ has
n<15 on the train slice (most single digits) — **insufficient** to even run
the restriction test this week. This is worth saying plainly rather than
forcing a call: at ~1/day combined per symbol, one archive does not give
enough trades-per-hour to trust an hour-level restriction on the live tiers.
Tier A (n=16 total) is thinner still and was not tested standalone.

**Shadow-only exploratory finding (not live, not actionable this week).**
Two per-stream sub-patterns technically survived the train→validation test:

- `vwap-reversion` MNQ, hour 1 (01:00 ET): train n=21, expectancy -$26.02;
  validation n=15, expectancy -$61.68. Both sides clear the n>=15 floor —
  this is the one bucket in the whole sweep with an adequately-sized, same-
  signed result on both slices.
- `vwap-reversion` MES, hour 2 (02:00 ET): train n=30, expectancy -$21.81;
  validation n=8, expectancy -$105.98 — same sign, but validation n=8 is
  **insufficient**, so this one is weaker evidence than it looks.

`vwap-reversion` is a shadow audition strategy, not a live tier — it has no
locks-adjustable behavior to change and is not proposed for any gate here.
It's recorded so a future promotion decision for `vwap-reversion` inherits
this note rather than rediscovering it.

`bollinger-breakout` MES hour 2 looked bad on train (n=15, -$67.51) and
flipped positive on validation (n=3, insufficient) — refuted, thin on both
sides.

**Overall H2 verdict: REFUTED** for the combined, cross-stream claim that
motivated it. No hour or weekday is a reliable drag across this shop's
combined book with n adequate to act on. The live tier-B streams simply
don't have enough n yet for an hour-level restriction to be evaluated
honestly — that is itself the finding, not a gap in the method.

---

## H3 — Cost sensitivity

**Method** (`scripts/diag/cost-sensitivity.ts`). Live config, unchanged,
re-run with `execution.slippage` at 1x/2x/3x ($0.25/0.50/0.75 per point) —
nothing else changes. Because slippage feeds the entry fill price itself,
this is a direct re-run (not a fixed-entry replay like H1) — a replay would
understate the effect. Measured over the full archive and, since there's no
train/validation split to speak of for a config that isn't being fit here,
checked for consistency across the same 11 one-day window shifts
`tier-a-baseline.ts` uses.

| stream | PF 1x | PF 2x | PF 3x | net 1x | net 2x | net 3x |
|---|---|---|---|---|---|---|
| A (n=16→15→15) | 1.27 | 1.03 | 1.05 | $357 | $45 | $73 |
| B:MES (n=62) | 1.41 | 1.38 | 1.21 | $1,643 | $1,552 | $939 |
| B:MNQ (n=56) | 1.25 | 1.28 | 1.30 | $877 | $960 | $1,017 |

**B:MES and B:MNQ: REFUTED.** PF stays comfortably above 1.0 through 3x
slippage on the full archive, and the 11-window-shift check confirms it
holds everywhere: B:MES PF ranges **1.24–1.47** at 2x across all 11 shifts,
B:MNQ ranges **1.17–1.44**. Whatever B's edge is, it isn't a fill-cost
artifact.

**Tier A: borderline, not a clean call either way.** The full-archive point
estimate says PF holds (1.03 at 2x), which by itself would refute H3. But
the same 11-window-shift check that confirmed B's result shows tier A's PF
at 2x ranges **0.85–1.03** — six of eleven shifts land *below* 1.0 (net
-$200), five land at 1.03 (net +$45). This is the same single-day clustering
`PHASE1-FINDINGS.md` already documents (14 of 16 trades on 2026-07-09):
whether that one cluster day sits inside or outside the trailing window
decides whether the 2x-slippage PF is above or below breakeven. **Tier A's
edge-survives-slippage claim is not robust enough to call refuted OR
survived** — it is exactly as fragile to window choice as its trade count
already was. This is not a new defect, it is the same one showing up in a
new measurement.

---

## What would change, and the gate it would need

No hypothesis produced a survivor with n adequate to propose a live change
this week. The closest thing to an actionable item is **not** a change:
tier A's cost-sensitivity number should be read alongside its known
clustering, not as a standalone PF, in any future dashboard or report.

The one candidate worth carrying into next week's queue (not proposed now,
per the standing rule against grid-searching or adding a parameter on a
single week's data): re-test "time stop @ 12 bars" specifically, on the next
week's fresh out-of-sample data, before treating its two coincidental wins
above as anything but noise. Gate, if it ever reaches that stage: it would
need to beat the live baseline's PF on a validation slice it was not
selected on, same as this week's test — which is precisely the test it
failed here for B:MES.

---

*Reproduce every number above*: `npx tsx scripts/diag/management-replay.ts`,
`npx tsx scripts/diag/time-of-day-expectancy.ts`,
`npx tsx scripts/diag/cost-sensitivity.ts`. All three are read-only.
