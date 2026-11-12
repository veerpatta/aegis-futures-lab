# Time machine filter — preregistration (2026-11-12)

Written and frozen before any result was computed. The machine copy is `lib/tm-study/rules.ts`
(version `tm-filter-v1`), whose configuration hash is
`7be49bdb83f3497e0dc9449da7516cbd896b2cda3e72db6bf000cc41fbfbdb7e`. `tests/tm-filter-rules.test.ts`
pins that hash and this document's own hash. A change to any rule needs a new version and a new
preregistration.

## Question

The time machine (`lib/timemachine`, on every trade page since 2026-11-12) replays the rest of
an idea's day 10,000 times from the same time of day on the 59 full trading days before it. Does
skipping the ideas it scores below zero after costs keep a set of ideas that beats taking every
idea, beats random skips of the same size, and makes money after costs?

Prior evidence says to expect "no": the methods that produce the ideas have not beaten random
entries (`docs/research/2026-08-17-remeasurement.md`), and the historical study's own filter
failed its final look by skipping losers without finding winners
(`docs/research/2026-10-07-historical-study-preregistration.md`). On the first three live trades
it was shown on, the time machine read "close to break-even". Nobody has compared its scores with
outcomes before this document was frozen.

## The rule

**Skip an idea when the time machine's average replay result, minus one contract's costs, is
below zero**, both measured in units of the idea's risk. Take it otherwise, including whenever the
time machine cannot run (fewer than 20 full past days, a short trading day, a decision outside
02:00 to 15:25 New York time, or a broken bracket).

Inputs, all known at the decision:

- **Entry**: the close of the last 5-minute bar closed at the decision time (the learner's own
  reference price). The replay starts at the first bar that starts at or after the decision.
- **Stop and target**: the idea's own. **Risk**: the distance from that entry to the stop.
- **Costs**: one contract's round-trip commission plus slippage on both sides at the decision
  time, from the learner's cost model (`lib/experiment/policy.ts`).
- **The time machine**: 10,000 replays, seed 19, ±2 bars of time-of-day, the latest 59 full
  days (at least 20), 02:00 to the 15:25 flatten, stop first, a bar touching both counts as the
  stop, a gap through the stop fills at the open. Days on or after the decision's day are never
  used.

The rule can only skip. It cannot size, enter, exit, or change a stop or a target.

## Scoring (both tests)

The ideas the filter keeps against:

- **take every idea**;
- **no trade** (0);
- **matched random skips**: the percentile of the kept ideas' total among random choices that
  skip the same number of ideas within each session (2,000 draws, seeded by the study id);
- the **per-idea delta** (kept result minus take-all result, a skipped idea counting 0) with a
  session-clustered bootstrap (2,000 resamples).

The result of an idea is its one-contract result after costs.

- **Pass**: the per-idea delta's interval lies above 0, the matched-random percentile is at least
  the look's, the kept ideas made money after costs, and the filter skipped between **10% and
  60%** of the ideas.
- **Fail**: the per-idea delta's upper bound is below 0.
- Otherwise **inconclusive**.

## Test 1: the historical archive (one look)

- **Population**: every eligible row of the registered historical study `hist-2026-10-07`
  (observation replay, its own exclusions), across all three of its periods. Each idea is
  regenerated from the Databento archive with the study's own code (`streamIdeas`,
  `replayIdea`); if any regenerated outcome does not match the stored one, the test stops before
  scoring.
- **Pool**: archive bars only. A day that touches a flagged data-fault window is left out of
  every pool.
- **One look** on all rows: a 95% interval and a random percentile of **≥ 95**. Stored once and
  never recomputed.
- **Label**: development-exposed. Earlier research inspected these periods; this filter was not
  fitted on them and has no parameter to fit.

## Test 2: forward, on the live learner

- **Population**: decisions of the active learner campaign recorded after the forward study was
  registered. Void outcomes and ideas the account could not take one contract of are excluded. A
  decision whose call was not stored within **24 hours** of the decision is excluded and counted.
- **Looks**, frozen as for the AI second opinion: ordered by when each decision was recorded; a
  look's window is the shortest prefix with its minimum resolved decisions and sessions; taken
  only when every decision in it is final; stored once.

| Look | Resolved decisions | Sessions | Interval | Random percentile for a pass |
|---|---|---|---|---|
| 1 | 60 | 15 | 99% | ≥ 99 |
| 2 | 150 | 15 | 95% | ≥ 95 |

A pass or a fail at a look is final. The forward test stops at its final look or after
**52 weeks**.

## What a result means

- A **historical pass** makes the filter eligible to shadow in the learner as a challenger. The
  learner's own preregistered adoption rules then decide whether it ever takes charge of trades.
- A **historical fail or inconclusive** closes this version's path to trades. The forward test
  still runs, for information.
- A **forward pass** makes the filter eligible for a future campaign.

Nothing here changes the account, a method's standing or the promotion gate directly. Results are
virtual and on delayed prices.
