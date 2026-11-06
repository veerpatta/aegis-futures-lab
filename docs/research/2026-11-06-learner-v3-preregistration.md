# Experimental learner — v3 campaign rules (2026-11-06)

Registered before any v3 campaign existed. Code: `lib/experiment/prereg.ts` (`PREREG_V3`,
version `exp-prereg-2026-11-06-v3`) and `lib/experiment/policy.ts` (`EXP_RISK_V3`, version
`exp-risk-2026-11-06`). New campaigns are registered under these (`CAMPAIGN_RULES`,
`CAMPAIGN_RISK`); a running campaign keeps the rules stored with it, so learner-2 is
unchanged. Pinned by `tests/experiment-v3-rules.test.ts`. Everything in
[the 2026-10-07 preregistration](2026-10-07-experiment-preregistration.md) still holds except
the three points below.

## Why a new version

A month of learner-2 (8 October to 6 November 2026) produced 27 decisions, 8 closed trades and
8 usable learning examples. Three causes were found in the stored evidence, none of them a
market result:

1. **Paused methods were invisible.** The learner decided only on ideas the Ideas tab shows,
   and a method its loss guard had paused was hidden there. From 16 to 30 October every source
   was paused (`bot_policy` rows 12, 13, 15), so the learner received no ideas for two weeks.
2. **Micro Nasdaq ideas did not fit the $100 rule.** Their stops run 50-70 points, so one
   contract risks $100-$145. Under the strict $100 per-trade limit almost every MNQ idea was
   skipped, and with quantity 0 its shadow outcome was also left out of learning. Two of the
   three skipped on 3-4 November reached their targets; one was stopped out. Small sample;
   the point is that they were never counted at all.
3. **No candidate could ever be adopted.** Since 8 October the account runs on the
   delayed-market clock, which labelled every decision "replay". Replay never counts toward the
   fresh confirmation window (≥ 20 fresh sessions and ≥ 60 fresh decisions), so the window could
   never fill. The Learn screen said so: "Delayed replay can help train a version. It cannot
   supply the fresh proof needed to adopt it."

## What changes

| | v2 (learner-2) | v3 |
|---|---|---|
| Ideas decided | visible ideas only: paused methods withheld | every filled idea from every method, paused or not; each decision records `sourcePaused`. Ideas built on stale bars stay out in both |
| One-contract exception | none: one contract over $100 is skipped | one contract may be taken when it risks more than $100 but no more than $150 (1.5%), inside the open-risk and daily room |
| Fresh evidence on the delayed clock | none: every decision is replay | a decision processed within 2 hours of its market time is prospective; a later backlog stays replay |

The decision itself is unchanged: it still sees only bars closed before its market time, is
filled at the next bar's open, and its features are frozen when it is made. Only its evidence
label depends on how promptly it was processed. Normal operation is 30-45 minutes (the
30-minute settlement window plus the 15-minute clock), well inside the 2 hours.

## What does not change

Every evidence floor (150 out-of-sample results, both interval lower bounds above 0, ≥ 95th
percentile against matched random picks, p95 drawdown under $2,000, positive with doubled
costs, a better Brier score, two passing reviews at least 6 days apart with ≥ 10 new results
each, a fresh window of ≥ 20 sessions and ≥ 60 decisions after registration), the 18-spec
search grid, the seed, the rollback rule, Amendment 1's lifecycle, the cost model, the $10,000
start, $100 per trade (outside the one-contract exception), $200 open risk, the $400 daily stop
and the $2,000 drawdown lock.

## What to expect, honestly

All the idea sources are refuted: none beat matched random entries in the corrected study, and
every newly benchmarked method so far also failed. Taking more of their ideas will most likely
lose more virtual money, not less. The point of v3 is that the learner can now gather evidence
at a usable rate and complete its own loop. At the October rate of 2-4 filled ideas a day, the
first candidate can train after a few weeks and the first full review needs a few months. "No
validated improvement" remains the expected result; a candidate is adopted only if it passes
every floor above on fresh evidence.

## Handover

A v3 campaign starts only after the learner's Neon Function (build `f194c9a`) stops ticking,
because it knows v1/v2 only and cannot be redeployed without the owner's Neon API key. The
database fence `db/migrations/20261106_learner_v3_runner_fence.sql` refuses that build's runs
for any campaign newer than v2. Steps are in [ENGINE-CLOCK.md](../ENGINE-CLOCK.md#handing-the-learner-over-to-v3).
