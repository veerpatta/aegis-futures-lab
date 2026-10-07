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
