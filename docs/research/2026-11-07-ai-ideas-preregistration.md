# AI research ideas — preregistration (2026-11-07)

Written and frozen before the first proposal. The machine copy is `lib/ai-ideas/rules.ts`
(version `ai-ideas-v1`, rule language `ai-ideas-dsl-v1`, prompt `ai-ideas-prompt-v1`), whose
configuration hash is `4ec78bd9173d5e3518a4c734b0b5ab58b27628f988c062171b6cb1d4be1ff71a`.
`tests/ai-ideas-rules.test.ts` pins that hash and this document's own hash. A change to any rule
needs a new version and a new preregistration.

## Question

The free AI reads statistics of the learner's finished ideas and proposes simple rules that
**skip** the ideas it thinks are worse. Does a rule, tested only on decisions made **after** it
was proposed, keep a set of ideas that beats taking every idea, beats random skips of the same
size, and makes money after costs?

Prior evidence says to expect "no": the methods that produce the ideas have not beaten random
entries, and patterns found in small samples are usually noise. That is why every rule is
tested only on fresh decisions, and why the thresholds below are strict.

## The rule language

A rule is `{name, why, when, then: "skip"}`: a plain name (at most 60 characters), a reason (at
most 300 characters), and one to three conditions that must all hold. A condition is
`{field, op, value}` with `op` one of `<`, `>`, `=`, `!=`. Only these fields exist, each read from
what the decision saved at decision time:

| Field | Type | Values | Ops |
|---|---|---|---|
| `side` | category | LONG, SHORT | `=` `!=` |
| `symbol` | category | MES, MNQ | `=` `!=` |
| `strategy` | category | rsi-reversion, zone-v5 | `=` `!=` |
| `tier` | category | A, B | `=` `!=` |
| `paused` | flag | true, false (the method was paused after a losing streak) | `=` `!=` |
| `regime` | category | trend-high-vol, trend-low-vol, range-high-vol, range-low-vol | `=` `!=` |
| `vix_bucket` | category | low, high | `=` `!=` |
| `rr` | number | 0 to 10 (reward to risk) | all |
| `atr_pct` | number | 0 to 5 | all |
| `vwap_atr` | number | -50 to 50 | all |
| `risk_usd` | number | 0 to 5000 (estimated one-contract risk) | all |
| `hour_ny` | whole number | 0 to 23 (New York hour of the decision) | all |
| `weekday` | category | Mon to Fri (New York) | `=` `!=` |

Anything else is refused. A field the decision does not have means the rule does not match, so
the idea is taken. A rule can only skip: it cannot size, enter, exit or read anything later than
the decision.

## Proposals

- At most **3** rules test at once; a proposal fills only the free slots.
- At most one proposal every **7 days**, and only once at least **20** finished decisions exist
  across all learner campaigns.
- The AI sees a facts table our code computes from the finished decisions (one per idea; void
  outcomes carry no result): for each field, buckets with the number of ideas, wins, win rate and
  the one-contract result per idea after costs. It returns a summary of 2 to 4 plain sentences and
  up to the free number of rules.
- A rule is kept only if it parses, is not already testing, and its name and reason quote no
  number that the facts (or its own thresholds) do not contain. The summary is stored as the
  week's note (accepted only if every number in it appears in the facts).
- A rule's proposal time is the moment it is stored; the database refuses a backdated proposal.

## Population

For each rule: the decisions the learner recorded **after** the rule was proposed (only the
active campaign records decisions), until the rule is retired. Excluded, as for the second
opinion and the learner's own dataset: void outcomes (no fill was possible, including cancelled
simulations) and ideas the account could not take even one contract of.

## Comparison

The ideas the rule keeps (those it does not match) against:

- **take every idea**;
- **no trade** (0);
- **matched random skips**: the percentile of the kept ideas' total among random choices that
  skip the same number of ideas within each session (2,000 draws, seeded by the rule's id);
- the **per-idea delta** (kept result minus take-all result) with a session-clustered bootstrap
  (2,000 resamples).

## Verdict

Two looks, frozen exactly as for the second opinion: decisions are ordered by when they were
recorded; a look's window is the shortest prefix with its minimum resolved decisions and
sessions, skipping excluded ones; the look is taken only when **every** decision in that window
is final; its result is **stored once** and never recomputed.

| Look | Resolved decisions | Sessions | Interval | Random percentile for a pass |
|---|---|---|---|---|
| 1 | 60 | 15 | 99.5% | ≥ 99.5 |
| 2 | 150 | 15 | 98.5% | ≥ 98.5 |

The thresholds are stricter than the second opinion's because up to three rules run at once.

- **Pass** at a look: the per-idea delta's interval lies above 0, the matched-random percentile
  is at least the look's, the kept ideas made money after costs, and the rule skipped between
  **10% and 60%** of the ideas.
- **Fail** at a look: the per-idea delta's upper bound is below 0.
- Otherwise **inconclusive**; before look 1, **too early**.

A pass or a fail at a look is final and ends the test. A rule is **retired** after a pass or a
fail, at the final look whatever its verdict, or **26 weeks** after it was proposed.

## What a pass means

A pass only makes the rule **eligible** for a future campaign that the owner starts under its own
preregistered rules. Nothing changes the account, the learner, the methods or the promotion gate
automatically.

## Terms and data

Proposals use NVIDIA's free trial API (evaluation, not production). The rules' names and reasons
and the week's summary are AI-written and shown only to the signed-in owner; the public
scoreboard shows numbers our code computes. See `docs/AI-HELPER.md`.
