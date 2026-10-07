# Experimental learner — preregistration (2026-10-07)

Frozen before any experiment data existed. Code: `lib/experiment/prereg.ts` (`PREREG`, version
`exp-prereg-2026-10-07`, seed `20261007`). Each campaign stores a copy of these rules and their
hash in `experiments.prereg` / `prereg_hash`; the database refuses edits. Changing a rule means
preregistering a new campaign, never editing a running one.

## What this is — and is not

A virtual-only $10,000 account that takes trade ideas on its own, records every take and skip,
simulates its own fills on delayed bars and learns in batches. It is **evidence collection, not a
claim that any method works**. It has no authority over the practice account (`paper_*`), the
promotion gate, method standing or the global model registry. The refuted methods stay frozen:
the learner may only decide *take or skip* on ideas they produce; it never edits a method's
parameters. "No validated improvement yet" is an expected, honest result.

## Incumbent

`v1-take-all` — take every visible, filled idea (the trial account's rule, frozen). Risk limits
apply to every model: $100 per trade, $200 open, $400 daily loss, $2,000 drawdown lock
(imported from `PAPER_RISK`).

## Evidence labels

| Provenance | Meaning | Counts as fresh evidence |
|---|---|---|
| prospective | decided within 30 min of the idea becoming visible, before its result was known | yes |
| late | seen more than 30 min after it became visible | never (training only) |
| replay | archived bars fed in time order | walk-forward only, never the fresh window |
| synthetic | generated prices | never (synthetic campaigns only, for software tests) |

## Search space (at most 3 new challengers per week, seeded draw, never repeated)

Logistic regression on winprob's featurizers, batch gradient descent (400 iterations, rate 0.1,
zero-initialised — deterministic). 18 specs:

- training window: all sessions · last 60 · last 120
- feature set: v1 (basic idea facts) · v2 (+ symbol, method, overnight, ATR %, VWAP distance)
- L2 strength: 0.001 · 0.01 · 0.1

Take rule: EV break-even threshold τ = mean loss ÷ (mean win + mean loss) on the training rows,
clamped to [0.05, 0.95]. No code generation, no free-form parameter search.

## Evaluation

- Dataset: closed, non-void outcomes closed before the cutoff, one per idea, with frozen
  features; each row's result is the one-contract shadow outcome × the contracts $100 of risk
  buys (net of modeled costs). Taken AND skipped ideas are included.
- Walk-forward: sessions split into 6 blocks, 5 expanding folds, 5-trading-day embargo on exit
  time, normaliser and τ fitted on training rows only, ≥ 50 training rows per fold.
- Matched comparison: challenger vs incumbent on the same test ideas. A frozen logit incumbent is
  compared only on ideas after its own training cutoff + embargo.
- Uncertainty: percentile bootstrap resampling whole sessions (B = 2000), α = 0.05 ÷ number of
  challengers judged that week (Bonferroni).

## Verdict (all must hold to pass)

1. ≥ 150 out-of-sample outcomes
2. gain per idea over the incumbent: interval lower bound > 0
3. net per idea: interval lower bound > 0 (beats the $0 no-trade baseline)
4. ≥ 95th percentile vs matched random picks (same count per session, R = 1000)
5. 95th-percentile session-reshuffled drawdown < $2,000
6. still positive with costs doubled
7. lower Brier score than the incumbent

Fewer than 150 outcomes, or an interval that includes "no improvement": **inconclusive**.
Clearly worse (upper bound < 0, drawdown or calibration failure with enough data): **rejected**.
Non-finite numbers or an invalid artifact: **invalid**. Win rate is never a criterion.

## Adoption (experiment pointer only)

Current review passes **and** a previous passing review of the same challenger ≥ 6 days earlier,
each with ≥ 10 new closed outcomes, **and** a fresh window after registration of ≥ 20 sessions and
≥ 60 prospective decisions scored live in shadow with positive gain and positive net. At most one
adoption per review (highest interval lower bound). The previous model is kept.

A challenger inconclusive 6 reviews running, or shadowing 6 weeks without passing, is retired.
*(Original rule. Replaced for challengers registered after 2026-10-07 by **Amendment 1** below.)*

## Rollback (preregistered, never on one losing trade)

- invalid output or artifact at a tick → immediate rollback inside the tick
- post-adoption drawdown ≥ $1,000
- ≥ 30 post-adoption outcomes and the matched gain vs take-all has an upper bound < 0
- Brier worse than the base rate on 2 consecutive nightly checks (≥ 30 outcomes)

Rollback restores the previous model (or v1). A rolled-back version can never return.

## Zero cost

Neon Free + Vercel Hobby + public-repo GitHub Actions. No paid data, no paid AI, no purchases.
Quota guard: ≥ 70% of the free database or run-time budget reduces optional jobs, ≥ 85% stops new
searches, ≥ 95% essential writes only (open trades still managed, new ideas recorded as skips).

## Feasibility, measured at launch (2026-10-07) — no rule changed

Replaying the 16 real, filled, visible ideas of the 10 days before launch through the
live decision rules, each decided at the moment the learner would first have seen it
(the next 15-minute check after the idea became visible):

| Outcome | Ideas |
|---|---|
| taken | 7 |
| skipped: the idea's own trade had already ended ("idea closed") | 6 |
| skipped: one contract would risk more than $100 | 3 |

About 1.6 ideas a day and 0.7 taken a day. ~~About 1 a day with a usable shadow outcome
(taken plus risk-skipped). At that rate the learner needs roughly 2–3 months before it
has the 50 finished trades to train its first candidate~~, and well over a year before
any candidate could meet the 150 out-of-sample and fresh-window floors. "No validated
improvement yet" is therefore the expected state for a long time. The floors stay as
preregistered: lowering them to get a faster answer would defeat their purpose.

**Correction (2026-10-07, historical learning plan review).** The struck sentence counted
the 3 risk-skipped ideas as usable outcomes. They are not: an idea whose smallest
contract risks more than $100 has quantity 0, and the learning dataset excludes
zero-quantity rows (`lib/experiment/dataset.ts`), as it should — it is not an executable
opportunity under this policy. Of the 16 ideas only the 7 taken ones were usable,
about 0.7 a day. Two further corrections:

- 50 is the minimum training rows *per evaluated walk-forward fold*, not a total. With
  six session blocks the earliest fold trains on one block, so a review with all five
  folds valid needs very roughly 300 eligible outcomes plus embargo losses — an
  illustration, not a rule. Sparse folds are skipped and now reported per fold
  (`Metrics.foldDetail`), and the Learn screen no longer shows "n of 50" as if it were
  the bar for a valid review.
- A 10-day sample does not support a calendar forecast. The screens show actual eligible
  counts and elapsed fresh sessions instead of a date.

Known consequence: under this campaign's original rules a native challenger retires after
6 weeks of shadowing, which at the measured idea rate is before it can reach 20 fresh
sessions and 60 fresh decisions. Corrected by **Amendment 1** below (lifecycle only). A candidate imported from the historical study runs under that study's own
registered lifecycle (52 weeks, `IMPORTED_LIFECYCLES` in `lib/experiment/prereg.ts`);
the evidence floors are the campaign's, unchanged.

The first live decision (09:25 UTC, MNQ) was an "idea closed" skip, labelled prospective.

## Amendment 1 — challenger lifecycle (recorded 2026-10-07)

**Declared** in `lib/experiment/prereg.ts` (`AMENDMENTS`, id `exp-amend-2026-10-07-lifecycle`);
**recorded** by `db/migrations/20261007_experiment_lifecycle_amendment.sql` as a
`rules_amended` row in learner-1's append-only change history. The stored campaign rules
(`experiments.prereg`, hash `50c2fd5d…4105`) are untouched and pinned by
`tests/experiment-amendment.test.ts`.

**Why.** The original lifecycle made adoption impossible. At about 0.7–1 executable idea a
trading day the learner needs ~50 closed outcomes before it can train anything, ~180
before a walk-forward review can have 150 out-of-sample results, and 60 fresh decisions
after a challenger's registration — months. A native challenger was retired after 6 weeks
or 6 inconclusive reviews (and before 150 outcomes every review is "inconclusive" by
definition), and with no limit on how many shadow at once the 18-spec grid was used up
within 6 weeks. No native challenger existed when the amendment was recorded, so it
cannot have been chosen in response to any challenger's results.

**What changes (lifecycle only).**

| | Original | Amendment 1 |
|---|---|---|
| Hard backstop | 6 weeks shadowing without a pass | 52 weeks shadowing without a pass |
| Inconclusive retirement | 6 inconclusive reviews in a row | 6 in a row that already had ≥ 150 out-of-sample outcomes (earlier ones mean "too early", not "no gain") |
| Shadowing at once | no limit | at most 3 native challengers; a new one fills a free slot (imported historical candidates do not take a slot) |
| Weekly registrations | ≤ 3 | ≤ 3 (unchanged) |

**What does not change.** Every evidence floor (150 out-of-sample outcomes, both lower
bounds > 0, ≥ 95th percentile vs random, p95 drawdown < $2,000, positive with doubled
costs, better Brier, two passing reviews ≥ 6 days apart with ≥ 10 new outcomes each, a
fresh window of ≥ 20 sessions and ≥ 60 decisions after registration), the 18-spec grid,
seeds, the rollback rule and the risk limits.

**Scope.** Applies to challengers registered after the record (their `registered_at` is
later than the record's time) and to search slots from the record on. A recorded
amendment the code does not declare, or whose rules differ from the declaration, stops
the review rather than being guessed. Campaigns registered from now on use
`exp-prereg-2026-10-07-v2`: the same rules with this lifecycle built in.

**Known limitation, recorded.** A longer life means more weekly looks at the same
challenger. Each look still needs a Bonferroni-adjusted session-bootstrap pass, two of
them at least 6 days apart, and a positive fresh window on decisions made after
registration; the cap of 3 keeps the number of challengers judged together small. It
does not remove the extra looks, so a pass remains evidence, not proof.
