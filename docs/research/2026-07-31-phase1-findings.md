# Phase 1 — the truth layer: findings

Measured 2026-07-31 on seven years of Databento GLBX.MDP3 bars (real MES/MNQ
contracts, 2019-05-06 → 2026-07-29, 1,015,938 bars). Paper only; no real money
has ever been deployed by this application.

Reproduce with:

```
BAR_SOURCE=databento npx tsx scripts/diag/random-entry.ts --iterations 1000
```

**The answer, first: the entry signals do not beat matched random entries. Zero
of seventeen symbol-years reach the 95th percentile. Two sit below the 5th.**

---

## 0. Correction to the Phase 0 audit

**The Phase 0 audit reported friction of $2.90–$3.65 per trade, explaining only
7–28% of the losses. That was wrong.**

The error: `scripts/engine/tiers.ts:375-379` records "realised risk" of $142.2
(MES) and $114.7 (MNQ). I read those as *per-contract* risk and concluded that
`floor(maxRisk / perContract)` had to be 1 contract. They are per-*trade* risk
— `qty × perContract`. Measured contract counts:

| Stream | Contracts per trade |
|---|---|
| Tier A zone-v5 | 1–55 (mean 11.67) |
| Tier B MES | 1–29 (mean 5.94) |
| Tier B MNQ | 1–33 (mean 3.83) |

Friction is charged per contract, so per-trade friction is several times what
the audit claimed. **The brief's first hypothesis was substantially correct**:
see §1. The second hypothesis (fixed 13-point stops) remains refuted — there is
no fixed-point stop anywhere; `rsi-reversion` uses `atrMult × ATR(14)` and
`zone-v5` stops at the zone's distal line.

The quantities also answer a question the correction raises: sizing is **not**
pinned at a ceiling. It varies per trade off the stop distance, so this is not
"one position size that happens to be too big".

---

## 1. Gross and net, side by side

Two separate runs of the same rules, one with `cost: 0, slippage: 0`. Not "net
plus costs added back": cost feeds `perContract`, which feeds `qty` through a
floor, and for `netDollar` targets it moves the target price itself.

| Stream | Trades | Gross | Net | Gross/trade | Net/trade | Cost share of loss | Same signals |
|---|---|---|---|---|---|---|---|
| Tier A zone-v5 | 1,180 | −$30,018 | −$57,065 | −$26.03 | −$48.36 | 47% | 1,117/1,180 |
| Tier B MES | 2,641 | −$10,809 | −$68,001 | −$4.09 | −$25.75 | 84% | 2,640/2,641 |
| Tier B MNQ | 2,731 | **+$214** | −$28,773 | **+$0.08** | −$10.54 | **101%** | 2,730/2,731 |

**MNQ is break-even gross.** Over 2,731 trades and seven years it makes $214,
and the entire $28,773 loss is transaction costs. That is close to exactly what
the brief predicted. MES loses a little gross; tier A loses substantially gross
and is the weakest of the three.

Costs were never missing from this engine — `engine.ts:181` has always computed
`pnl = points × pointValue × qty − cost × qty`, and every figure in
`TUNING_BASELINE` is net. What was missing was the counterfactual.

**Break-even gross is not edge.** A strategy has to beat its costs, not tie
them. §3 is what settles whether the entries contribute anything at all.

---

## 2. Excursion: where the trades die

MAE/MFE normalised by ATR at entry rather than by R — R divides by the trade's
own stop, which is itself volatility-scaled, making R-normalised excursion
partly circular.

| Stream | n | MAE (ATR) | MFE (ATR) | Edge ratio | Winners | Losers | min→MAE | min→MFE |
|---|---|---|---|---|---|---|---|---|
| Tier A | 1,180 | 1.278 | 1.436 | 1.124 | 5.384 | 0.505 | 23.4 | 21.6 |
| Tier B MES | 2,641 | 1.628 | 1.544 | 0.948 | 3.850 | 0.360 | 24.4 | 26.8 |
| Tier B MNQ | 2,731 | 1.555 | 1.626 | 1.046 | 4.183 | 0.388 | 25.0 | 25.4 |

**Edge ratio sits at ~1.0 in all three streams.** The average trade shows about
as much favourable travel as adverse before it resolves. That is the signature
of an entry with no directional tilt, and it is measured entirely independently
of the random-entry test in §3 — two different methods agreeing.

Time-to-MAE and time-to-MFE are also near-identical (~21–27 minutes each way),
so this is not "the entry is right but the exit is wrong". There is no
systematic early favourable move being given back.

The winner/loser split is what a symmetric no-edge process looks like once you
condition on outcome: winners necessarily ran further favourably (5.4, 3.9,
4.2) and losers necessarily ran further adversely (0.51, 0.36, 0.39). That is
selection, not skill — conditioning on the outcome guarantees it.

---

## 3. The random-entry benchmark

Each null book holds **fixed**: trade management (same stop and target rule),
the cost model (byte-identical `ExecutionConfig`), the session filter, the
trade count, the direction mix, the symbol mix and the time-of-day
distribution. It **randomises** entry timing and direction. The null runs
through the same `runBacktest` as the real book, so "management and costs held
fixed" is true by construction rather than by assertion.

### Interpretation rule, fixed in code before any cell was run

| Result | Reading |
|---|---|
| Real ≥ 95th percentile | The entry signal carries information. |
| Real within 20th–80th | The entry contributes nothing. Parameter tuning cannot help. |
| Real ≤ 5th percentile | The entries are actively anti-predictive. |

Encoded in `verdictFor()` (`lib/diagnostics/randomEntryRun.ts`). Registered in
`research_trials` before the run, with an honest note that a 5-iteration smoke
run had already been executed for plumbing verification, so the *direction* of
the prediction was informed rather than blind.

### Results

| Cell | Trades | Real avg R | Null median | Null p95 | Percentile | p | Realised N | Verdict |
|---|---|---|---|---|---|---|---|---|
| A \| all | 1,180 | −0.302 | −0.168 | −0.096 | **0.0** | 1.0000 | 57% | **worse than random** |
| B:MES \| 2019 | 240 | −0.323 | −0.250 | −0.142 | 12.6 | 0.8741 | 95% | no better |
| B:MES \| 2020 | 342 | −0.176 | −0.139 | −0.042 | 27.8 | 0.7223 | 95% | no better |
| B:MES \| 2021 | 376 | −0.231 | −0.171 | −0.076 | 13.1 | 0.8691 | 95% | no better |
| B:MES \| 2022 | 357 | −0.140 | −0.114 | −0.008 | 35.2 | 0.6484 | 96% | no better |
| B:MES \| 2023 | 363 | −0.124 | −0.175 | −0.080 | 81.0 | 0.1908 | 96% | no better |
| B:MES \| 2024 | 382 | −0.137 | −0.173 | −0.086 | 73.9 | 0.2617 | 95% | no better |
| B:MES \| 2025 | 384 | −0.138 | −0.124 | −0.031 | 40.3 | 0.5974 | 94% | no better |
| B:MES \| 2026 | 197 | −0.178 | −0.099 | 0.030 | 17.2 | 0.8282 | 95% | no better |
| B:MNQ \| 2019 | 254 | −0.233 | −0.170 | −0.064 | 15.2 | 0.8482 | 95% | no better |
| B:MNQ \| 2020 | 358 | 0.008 | −0.084 | 0.011 | 94.6 | 0.0549 | 94% | no better |
| B:MNQ \| 2021 | 397 | −0.218 | −0.089 | 0.001 | **0.7** | 0.9930 | 95% | **worse than random** |
| B:MNQ \| 2022 | 392 | −0.023 | −0.066 | 0.033 | 76.2 | 0.2388 | 95% | no better |
| B:MNQ \| 2023 | 387 | −0.017 | −0.104 | −0.008 | 93.0 | 0.0709 | 96% | no better |
| B:MNQ \| 2024 | 390 | −0.027 | −0.079 | 0.016 | 81.8 | 0.1828 | 95% | no better |
| B:MNQ \| 2025 | 371 | −0.037 | −0.063 | 0.046 | 65.2 | 0.3487 | 92% | no better |
| B:MNQ \| 2026 | 182 | −0.078 | −0.046 | 0.109 | 37.0 | 0.6304 | 87% | no better |

**0 of 17 cells reach the 95th percentile.**

### Three things this table says that the headline does not

**1. The null's median is negative in every single cell.** Random entries with
this trade management and these costs also lose money. That is a *separate*
finding and must not be read as a verdict on the entries: it says the loss is
produced by the cost-and-management geometry, not by entry selection. Put
plainly — with these stops, these targets and this friction, you lose money
whatever you do, and the entry rule neither helps nor is the cause.

**2. The near-misses are what noise looks like, not what edge looks like.**
MNQ 2020 lands at the 94.6th percentile and MNQ 2023 at the 93.0th. With 17
cells, roughly one crossing the 95th by chance is the expectation. Zero
crossings with two near the line is fully consistent with no signal, and
treating either as promising would be exactly the selection this brief exists
to prevent.

**3. Two cells are actively anti-predictive.** Tier A over the whole archive
sits at the 0.0th percentile — worse than all 250 matched random books. MNQ
2021 sits at the 0.7th. This is a stronger claim than "no edge": the zone
entries systematically pick worse-than-random moments.

### Deviations, stated rather than buried

- **Tier A is not split by symbol-year.** It trades on 287 of 1,838 sessions,
  so one tier-A year is ~65 trades. It gets one whole-archive cell.
- **Tier A's null is approximate on two counts** and is weaker evidence than
  tier B's: the live stream rests limit orders at zone lines (a random entry
  has no zone, so its null fills at next-open), and its structural stop is
  bootstrapped from the real book in ATR units rather than reproduced.
- **Tier A runs 250 iterations, tier B 1,000.** Tier A's whole-archive null
  re-indexes a 1,000,000-bar union timeline every iteration — ~200× the cost of
  a tier-B symbol-year, and 19.5 minutes of compute as it stands. 250 draws
  still resolve the 95th percentile and put the p-value floor at 0.004. The
  result is not marginal (percentile 0.0), so precision is not the binding
  constraint.
- **Realised trade counts.** Drawn entries landing inside an open trade are
  skipped by the engine, so the null's realised count is an output, not an
  assumption. Tier B realises 87–96%. **Tier A realises only 57%**, because its
  clustered profile puts several entries into the same session — another reason
  its cell is the weaker evidence.

---

## 4. How much evidence is this really?

| Pair | Overall ρ | Median rolling | Min rolling | Windows > 0.8 | Nominal trades | Effective |
|---|---|---|---|---|---|---|
| MES/MNQ | 0.923 | 0.919 | 0.231 | 92% | 5,372 | 2,794 |

**5,372 nominal tier-B trades ≈ 2,794 effective (52%).** MES and MNQ are both
US equity index futures and move together intraday; 92% of rolling five-session
windows show correlation above 0.8.

So "16 stream-years, all losing" is closer to **eight** independent
observations. This cuts both ways and is stated for that reason: it weakens the
negative finding exactly as much as it would weaken a positive one. Eight
independent losing years is still decisive; it is simply not sixteen.

---

## 5. What this means

**The zone methodology and the RSI-reversion streams have no demonstrable entry
edge.** Two independent measurements agree: the edge ratio sits at ~1.0 (no
directional tilt at entry), and zero of seventeen symbol-years beat matched
random entries.

This is a clean negative result, and per the brief it is a successful outcome.

Three things follow, and they are different from each other:

1. **The entries contribute nothing.** No parameter change to `zone-v5` or
   `rsi-reversion` can fix this, because the thing being tuned is not carrying
   information. Grid-searching either would be curve-fitting against noise.

2. **Tier A is worse than that** — it selects worse-than-random moments, at the
   0.0th percentile. It should not be promoted past `shadow` under any
   evidence gate.

3. **The cost-and-management geometry loses money on its own.** The null's
   median is negative everywhere. With ~4–12 contracts per trade at $2.90–$3.65
   per contract round trip, friction is $11–$43 a trade against ATR-scaled
   stops that do not pay for it. Any future hypothesis tested on this
   infrastructure needs sizing and holding-period economics that clear friction
   *before* the entry rule is asked to do any work — otherwise it inherits the
   same defeat regardless of how good its signal is.

**Recommendation: proceed to Phase 4, not Phase 2.** The Phase 2 gate requires
beating random entries at the 95th percentile; nothing does. The Phase 1
machinery built here is hypothesis-agnostic and is the durable value: any of
the Phase 4 candidates (opening-range breakout with a relative-volume filter,
time-series momentum, intraday seasonality, turn-of-the-month) can be run
through the same gross/net split, the same excursion measurement and the same
random-entry benchmark on day one.

### Two things worth fixing regardless

- **Fill realism at the extremes.** Tier A sizes up to 55 contracts, which
  implies a stop roughly 0.1 points from entry. A 55-lot fill on a 0.1-point
  stop is not a trade anyone gets. This inflates both gross and net figures at
  the tail and deserves a minimum-stop-distance guard.
- **The exit side of the cost model is optimistic.** No slippage is charged on
  any exit, and stops fill at the exact stop price even when the bar gapped
  through. `REALISTIC_MODEL` (both sides slipped, 1.5× at session edges,
  gap-through stops) is built and tested but deliberately **not** adopted,
  because switching it on invalidates every `outOfSample` provenance string in
  `TUNING_BASELINE` and needs its own re-measurement commit. Predicted effect:
  MES friction $3.65 → $4.90, MNQ $2.90 → $3.40.

---

## Validation of the benchmark itself

A bug here would silently invalidate the central conclusion, so it is tested
directly (`tests/random-entry.test.ts`):

- **P-value uniformity.** Feeding the benchmark an "observed" book that is
  itself an independently seeded draw from the same process produces uniform
  p-values across 120 repeats. This is the definition of a calibrated test and
  catches degenerate RNG, off-by-one fill timing and a wrong percentile
  convention in one assertion. The independent seeding is load-bearing — share
  the seeds and the check becomes tautological.
- **Positive control.** A book built with genuine look-ahead lands above the
  95th percentile, so the test demonstrably has power.
- **Pool membership.** Every bar the real strategy entered on is in the
  candidate pool. Uniformity will not catch a biased pool: a null sampled from
  a stricter universe than the strategy is internally consistent and still
  wrong.
- **Cost parity.** The null's `ExecutionConfig` is the real book's. A
  cost-free null would out-earn reality and wrongly "prove" the strategy bad.
- **Look-ahead is a compile error.** The sampler receives only
  `{symbol, index, time, minuteOfDay, dateKey}` — no price fields — so
  selecting entries by what price did next is not expressible.
