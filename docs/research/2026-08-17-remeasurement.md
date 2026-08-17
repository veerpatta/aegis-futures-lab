# Phase 1, re-measured on a corrected engine — findings

Measured 2026-08-17 on the same seven years of Databento GLBX.MDP3 bars as the
original Phase 1 run (real MES/MNQ, 2019-05-06 → 2026-07-29, ~1,016,000 bars).
Paper only; no real money has ever been deployed by this application.

Reproduce:

```
BAR_SOURCE=databento npx tsx scripts/diag/random-entry.ts --iterations 1000
```

**The headline survives: 0 of 17 symbol-years reach the 95th percentile of
matched random entries. The entries still contribute nothing.**

**Two of the numbers underneath it do not survive, and both were load-bearing.**

---

## 0. Why this was re-run

`docs/research/2026-07-31-phase1-findings.md` closed with two defects it said
were "worth fixing regardless": fill realism at the extremes (tier A sizing to
55 contracts on a ~0.1-point stop — "not a trade anyone gets"), and an exit
cost model that charged nothing on the way out and filled gapped stops at a
price that never traded.

Fixing those meant the published figures described an engine that no longer
existed, so the whole of Phase 1 was re-run. Six corrections were adopted
together, each of which had been a parameter defaulting to the legacy
behaviour:

| Correction | What it changes |
|---|---|
| `minStopPoints: 2.0` | refuses a stop too tight to be a real fill |
| `restingLimitOrders` | a limit order fills on a LATER bar than the one that decided it |
| `friction` (REALISTIC_MODEL) | slippage on both sides, 1.5× at session edges, gapped stops fill at the open, exit slippage inside sizing |
| `causalBlocked80` | the 80% rule asks whether a zone was broken YET, not whether it was ever broken |
| `sessionAnchoredFrames` | 4H bars bin on NY wall-clock, not the UTC epoch |
| `requireContiguous` | an RSI cross must be built from two genuinely adjacent bars |

The commission and slippage SCALARS are unchanged: $1.20 per side per
contract, one tick. What changed is where and how often they are charged.

---

## 1. Gross and net, old engine beside new

| Stream | Trades (was) | Gross (was) | Net (was) | Cost share (was) |
|---|---|---|---|---|
| Tier A zone-v5 | **442** (1,180) | **−$10,563** (−$30,018) | **−$14,317** (−$57,065) | 26% (47%) |
| Tier B MES | **2,578** (2,641) | **−$57,009** (−$10,809) | **−$83,247** (−$68,001) | 32% (84%) |
| Tier B MNQ | **2,713** (2,731) | **−$19,286** (**+$214**) | **−$40,650** (−$28,773) | 53% (101%) |

### 1a. Tier A lost 738 of its 1,180 trades, and they were the ones doing the damage

**63% of tier A's trade count was fills that could not happen.** Two defects
produced them and both are now closed: the same-bar limit fill (an order was
only ever treated as resting on the bars where it demonstrably filled) and the
absent minimum stop distance (a 0.1-point stop sized to the risk cap).

Its net loss falls from −$57,065 to −$14,317 — not because the strategy
improved, but because most of the loss lived in trades nobody could have taken.
The remaining 442 trades still lose money.

### 1b. "MNQ is break-even gross" does not survive, and it was the most quoted line in the original

The original found MNQ making **+$214 gross** over 2,731 trades and concluded
that its entire $28,773 loss was transaction costs — the sharpest version of
"the geometry loses money on its own".

Under realistic exits it makes **−$19,286 gross**. The break-even reading was an
artefact of filling every stop at exactly the stop price, including on bars that
gapped straight through it. That is a free option the market does not offer,
and MNQ's stops collected it 2,713 times.

So the corrected statement is weaker and less flattering: **the MNQ entries lose
money before costs, not only after them.** Costs still make it worse (53% of the
loss), but they are no longer the whole story.

MES moves the same way for the same reason, and further: −$10,809 gross becomes
−$57,009.

---

## 2. The random-entry benchmark

Interpretation rule unchanged and still fixed in `verdictFor()`
(`lib/diagnostics/randomEntryRun.ts`): ≥95th percentile means the entry carries
information; ≤5th means actively anti-predictive; the middle means it
contributes nothing.

| Cell | Trades | Real avg R | Null median | Percentile | Was | Verdict |
|---|---|---|---|---|---|---|
| A \| all | 442 | −0.217 | −0.196 | **37.2** | **0.0** | no better |
| B:MES \| 2019 | 214 | −0.392 | −0.249 | **3.3** | 12.6 | **worse than random** |
| B:MES \| 2020 | 328 | −0.210 | −0.195 | 39.9 | 27.8 | no better |
| B:MES \| 2021 | 365 | −0.287 | −0.213 | 8.9 | 13.1 | no better |
| B:MES \| 2022 | 357 | −0.178 | −0.155 | 36.0 | 35.2 | no better |
| B:MES \| 2023 | 359 | −0.166 | −0.218 | 80.9 | 81.0 | no better |
| B:MES \| 2024 | 375 | −0.190 | −0.219 | 69.7 | 73.9 | no better |
| B:MES \| 2025 | 384 | −0.185 | −0.173 | 40.8 | 40.3 | no better |
| B:MES \| 2026 | 196 | −0.241 | −0.147 | 11.3 | 17.2 | no better |
| B:MNQ \| 2019 | 251 | −0.264 | −0.204 | 19.8 | 15.2 | no better |
| B:MNQ \| 2020 | 356 | −0.028 | −0.129 | 93.4 | 94.6 | no better |
| B:MNQ \| 2021 | 394 | −0.255 | −0.117 | **0.6** | 0.7 | **worse than random** |
| B:MNQ \| 2022 | 390 | −0.055 | −0.083 | 68.1 | 76.2 | no better |
| B:MNQ \| 2023 | 385 | −0.071 | −0.122 | 81.0 | 93.0 | no better |
| B:MNQ \| 2024 | 386 | −0.042 | −0.107 | 86.2 | 81.8 | no better |
| B:MNQ \| 2025 | 370 | −0.061 | −0.095 | 70.4 | 65.2 | no better |
| B:MNQ \| 2026 | 181 | −0.122 | −0.064 | 27.4 | 37.0 | no better |

**0 of 17 clear the 95th percentile. Still two below the 5th — but not the same two.**

### 2a. Tier A was never "actively anti-predictive". That finding was an artefact.

The original's strongest claim about tier A was that it sat at the **0.0th
percentile** — worse than all 250 matched random books — and that this was "a
stronger claim than no edge: the zone entries systematically pick worse-than-
random moments."

On the corrected engine tier A sits at the **37.2nd percentile**: ordinary,
indistinguishable from random, in the middle of the null.

That is a correction to the record and it should be stated plainly. The 0.0
reading was measuring the impossible fills, not the zone selection. The
original run gave the real book a better-than-market entry price and unlimited
size on hairline stops, and both cut against it — the trades it was uniquely
able to take were bad ones. Remove them and the entries look like what they
are: noise.

**This does not rehabilitate tier A.** 37.2 is not 95, the null median is
negative, and the stream still loses $14,317 over 442 trades. It simply is not
the case that the entries are worse than a coin flip.

### 2b. B:MES 2019 moved the other way

12.6 → 3.3, into the anti-predictive band. With 17 cells and this much
re-measurement, one cell crossing a threshold in either direction is what noise
does; it is recorded here rather than interpreted.

### 2c. The finding that survives untouched

**The null's median is negative in all 17 cells**, exactly as before. Random
entries with this trade management and these costs also lose money. The
cost-and-management geometry still loses on its own, and the entry rule still
neither helps nor causes it.

### 2d. Realised trade counts

Tier A realises **54%** of drawn entries (was 57%) and tier B **71–96%** (was
87–96%). The corrected engine refuses more entries — the minimum stop distance
applies to the null as well as the real book, which is what keeps the
comparison matched. Realised N is an output, not an assumption.

---

## 3. Excursion — the independent measurement still agrees

| Stream | n | MAE (ATR) | MFE (ATR) | Edge ratio | Was |
|---|---|---|---|---|---|
| Tier A | 442 | 1.559 | 1.687 | 1.082 | 1.124 |
| Tier B MES | 2,578 | 1.623 | 1.543 | 0.951 | 0.948 |
| Tier B MNQ | 2,713 | 1.558 | 1.624 | 1.043 | 1.046 |

Edge ratio sits at ~1.0 in all three, essentially unmoved. Two independent
methods still agree: the average trade shows about as much favourable travel as
adverse before it resolves, which is the signature of an entry with no
directional tilt.

That these barely moved while the P&L moved a great deal is itself informative
— the corrections changed what the book could execute and what it paid, not
what price did after entry.

---

## 4. Evidence weight

MES/MNQ correlation is unchanged at ρ=0.923 (median rolling 0.919, 92% of
five-session windows above 0.8). **5,291 nominal tier-B trades ≈ 2,752
effective (52%).** Sixteen stream-years remains closer to eight independent
observations, and that discount applies to this negative result exactly as it
applied to the last one.

---

## 5. What this means

1. **The conclusion is unchanged.** Neither the zone methodology nor the
   RSI-reversion streams has a demonstrable entry edge. Nothing beats matched
   random entries. No parameter change fixes that, because the thing being
   tuned carries no information.

2. **Tier A is not anti-predictive**, and the earlier claim that it was should
   be treated as withdrawn. It is ordinary noise that loses money.

3. **The costs-are-everything reading is weaker than it looked.** MNQ was the
   evidence for it and MNQ was break-even gross only because gapped stops filled
   at a price that never traded. Entries lose money before costs too.

4. **The engine is now honest about what it can execute.** 738 tier-A trades
   and the exit-side free option are gone. Any future candidate measured on this
   infrastructure is measured against fills it could actually get — which was
   the point of the Phase 1 machinery, and is the durable value here.

### One operational rule survives with a weaker justification

The 2026-07-31 findings concluded that tier A "should not be promoted past
`shadow` under **any** evidence gate", and grounded that in the 0.0th
percentile — a claim about the entries being actively harmful.

**Keep the rule, drop the reasoning.** Tier A must still not be promoted, but
for the ordinary reason the other two streams must not be: it fails the p95
gate. That is a materially weaker statement than the original, and the
difference matters operationally. "Never, under any gate" is a permanent
blacklist that no future evidence could lift. "Fails the gate at 37.2" is a
verdict a genuinely better tier-A configuration could in principle overturn by
clearing the gate — which is exactly what `lib/validation/promotionGate.ts`
exists to adjudicate, and it should be allowed to.

This does not license tuning tier A. Conclusion 1 is untouched: the entries
carry no information, so grid-searching them is curve-fitting against noise.

---

## 6. Recommendation

**Proceed to Phase 4, not Phase 2. Unchanged, and now on firmer ground.**

The Phase 2 gate requires beating matched random entries at the 95th
percentile. Nothing does, on either engine, in any of 17 cells. Re-measuring
did not rescue a single stream, and the two corrections that moved numbers
materially moved them for reasons unrelated to entry quality.

Three things changed about *why* this is the recommendation:

1. **The "two things worth fixing regardless" are now fixed.** The original
   flagged fill realism at the extremes and the optimistic exit model as
   defects to correct before the infrastructure could be trusted. Both are
   closed, so a Phase 4 candidate now inherits an engine that refuses fills it
   could not get and charges the round trip it would actually pay.

2. **The friction bar is higher than the original stated, and it is the
   binding constraint.** Conclusion 3 survives — the null's median is negative
   in all 17 cells, so the geometry still loses on its own — but the corrected
   model makes it harsher: measured drag is $3,754 / $26,238 / $21,363 against
   modelled costs of $8,619 / $49,224 / $29,348. Any Phase 4 hypothesis must
   clear that *before* its entry rule is asked to do any work. A candidate that
   is merely "not obviously losing" gross will not survive contact with it.

3. **The costs-are-everything reading is no longer available as a consolation.**
   The original left open a hopeful interpretation: MNQ was break-even gross, so
   perhaps the entries were fine and only the plumbing was broken. They were
   not. All three streams lose gross under realistic exits. There is no
   "fix the costs and this works" candidate hiding in the incumbents.

**What to run first.** The Phase 4 candidates already registered — opening-range
breakout with a relative-volume filter, time-series momentum, intraday
seasonality, turn-of-the-month — go through the same gross/net split, the same
excursion measurement and the same random-entry benchmark, unchanged. Register
the hypothesis, prediction and decision rule in `research_trials` **before**
looking at results; `scripts/diag/phase4.ts` reads the trial count to build the
deflated-Sharpe hurdle and throws rather than guessing when it cannot.

**What not to do.** Do not tune `zone-v5` or `rsi-reversion`. Do not read
MNQ 2020 at the 93.4th percentile or MNQ 2024 at 86.2 as promising: with 17
cells, roughly one crossing p95 by chance is the expectation, and treating a
near-miss as a signal is the selection this brief exists to prevent.

---

Both baselines are in `research_baselines`, side by side and immutable: the
`phase1-*` rows measured the old engine, the 2026-08-17 rows measured this one.
The table's no-edit trigger means correcting a measurement can only ever mean
adding a row, never quietly amending one.
