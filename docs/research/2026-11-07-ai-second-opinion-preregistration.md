# AI second opinion — preregistration (2026-11-07)

Written and frozen before the first call. The machine copy of these rules is
`lib/ai-judge/studies.ts`; `tests/ai-judge-studies.test.ts` pins the hash of each study's
configuration, and the registration rows in `db/migrations/20261107_ai_helper.sql` carry the
same hashes. A change to any rule needs a new study id and a new preregistration.

## Question

Can a large language model, shown only what was known when an idea was made, pick out the
learner's better ideas from its worse ones — well enough that taking only its picks beats
taking every idea, beats random picks of the same number, and makes money after costs?

Prior evidence says to expect "no": none of the methods that produce these ideas beats random
entries (`docs/research/2026-08-17-remeasurement.md`), so any edge would have to come from the
model's selection alone. The study is designed so that a lucky streak cannot pass for skill.

## Studies (one per model)

| Study | Model (NVIDIA API catalog, free trial) | Status at registration | Config hash |
|---|---|---|---|
| `ai-judge-nemotron-ultra-v1` | `nvidia/nemotron-3-ultra-550b-a55b` | active from registration | `8c971da6e9cbd149cd9f953f92f3fe1f0eb6b148a018378f938b56b5fb124a68` |
| `ai-judge-kimi-k3.1-pro-v1` | `moonshotai/kimi-k3.1-pro` | waiting for the model's first answer | `ca0815c88b04c76fbc98f6d7ea3917a3e80e9713838efd88c759d46faaedffd3` |

Kimi K3.1 Pro is what the owner asked for, but on 2026-11-06 NVIDIA served it only in its web
playground (the API answered 404), and Kimi K2.6 was "not found" for the owner's account. The
Kimi study is registered now with identical rules; it is probed at most once every six hours
and starts (its `started_at` is set, once) at the first successful answer. Evidence from the two
models is never mixed, and there is no fallback model inside a study.

Prompt version `ai-judge-prompt-v1`, feature version `ai-judge-features-v1`.

## Population

Every decision — taken or skipped, paused methods included — of the active learner campaign
(`experiments.lineage = 'learner'`, `status = 'active'`) whose row was recorded at or after the
study's `started_at`. Decisions are asked oldest first.

**Freshness.** A decision is asked only within two hours (7,200 s) of its row being recorded.
Later, it is never asked.

## Inputs (point in time)

Only facts known at the decision's information cutoff (`experiment_decisions.info_cutoff`):

- the idea: market, side in plain words, the method and its plain description, whether the
  method was paused after a losing streak, New York time, minutes until the bot must be flat,
  entry, stop, target, reward to risk, one-contract risk in dollars;
- the learner's saved features: regime, volatility-index level, ATR as a percent of price,
  distance from the day's average price in ATR;
- context computed from `bars_5m` (source `yahoo`) bars that **ended** at or before the cutoff:
  change since today's open, change since the previous session's close, change over the last
  15 minutes, 1 hour and 4 hours, ATR(14) on 5-minute bars in points, the stop distance in ATR,
  RSI(14) on 5-minute bars, position in today's range (0 = low, 1 = high), and the 1-hour trend
  (sign of a 10-hour EMA slope). "Today" is the New York trading day, as everywhere in the app.

`marketContext()` drops every bar that had not ended by the cutoff, whatever the caller passes.
The model never sees what the bot did with the idea, its result, or anything later.

## Output

One JSON object: `decision` take or skip, `confidence` 0-100 (rounded to a whole number) and a
plain-English `reason` (asked for at most 60 words). An answer without a usable decision,
confidence and reason is recorded as **invalid** and never re-asked. A provider failure, where
no answer was seen, may be retried in a later pass while the two-hour window is open, at most
three attempts. Every attempt is claimed in `ai_judge_calls` before the call, and the first
final answer per study and decision is write-once (a database index and an append-only trigger
enforce it).

## Outcome

The learner's own one-contract shadow result for the decision, after modelled costs
(`experiment_outcomes.net`). A cancelled simulation counts as 0. Excluded, as in the learner's
training data: void outcomes, and ideas the account could not take even one contract of
(`standalone_qty < 1`).

## Comparison

On the resolved calls, in decision order:

- **AI picks**: the sum of the results of the ideas the model said to take;
- **take every idea**: the sum of all results;
- **no trade**: 0;
- **matched random**: the percentile of the AI picks' total among random picks of the same
  number of ideas within each session (2,000 draws, seeded by the study id);
- **per-idea delta**: (AI result − take-all result) per idea, with a session-clustered bootstrap
  interval (2,000 resamples).

## Verdict

Two looks. Each is taken **once**, at the first moment its minimum resolved calls and sessions
are both met, on the calls resolved up to then in decision order. A pass or a fail at a look is
final. Otherwise the next look follows. The running totals shown between looks are information,
not a verdict.

| Look | Resolved calls | Sessions | Interval | Random percentile for a pass |
|---|---|---|---|---|
| 1 | 60 | 15 | 99% | ≥ 99 |
| 2 | 150 | 15 | 95% | ≥ 95 |

- **Pass** at a look: the per-idea delta's interval lies above 0, the matched-random percentile
  is at least the look's, the AI picks made money after costs, and the model took between 10%
  and 90% of the ideas.
- **Fail** at a look: the delta's upper bound is below 0, or the AI picks made less than
  take-all while the matched-random percentile is below 50.
- Otherwise **inconclusive**. Before look 1: **too early**.

## What a pass means

A pass only makes an AI filter **eligible** for a future campaign that the owner starts under its
own preregistered rules. Nothing changes automatically: the study never touches the account,
the learner's pointer, the methods' standing or the promotion gate.

## Terms and data

NVIDIA's free API is a trial for evaluation, not production; its terms forbid making generated
content available to others and allow NVIDIA to use inputs and outputs to improve its models.
This study is an evaluation. Only market facts and the bot's own records are sent; the model's
reasons are shown only to the signed-in owner, and the public scoreboard shows numbers our code
computes. See `docs/AI-HELPER.md`.
