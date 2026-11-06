# AI second opinion — DeepSeek V4.1 Flash addendum (2026-11-07)

Written and frozen before this study's first call (it has none). It adds one study to
`docs/research/2026-11-07-ai-second-opinion-preregistration.md` and changes none of that
document's rules; that document stays pinned by its hash. The machine copy is
`DEEPSEEK_JUDGE_STUDY` in `lib/ai-judge/studies.ts`; `tests/ai-judge-studies.test.ts` pins its
configuration hash and this document's hash, and `db/migrations/20261107_ai_deepseek.sql`
registers it with the same hash.

## The new study

| Study | Model (NVIDIA API catalog, free trial) | Status at registration | Config hash |
|---|---|---|---|
| `ai-judge-deepseek-v4.1-flash-v1` | `deepseek-ai/deepseek-v4.1-flash` | waiting for the model's first answer | `0f6364f6512b1d128d86b9d2c65f9fedd53a0e881dc838ec8d11e5144ac117e8` |

The owner asked for DeepSeek V4.1 Flash on 2026-11-07. NVIDIA's API catalog lists it, but on
2026-11-06 (UTC) every request to it, streamed or not and with thinking on or off, ended with
"upstream request failed" (HTTP 502) after about 30 seconds, while Gemma 4 answered the same
request in about 2 seconds. So the study is registered now, before any of its evidence exists,
and waits as the Kimi study does: it is probed at most once every six hours and starts (its
`started_at` is set, once, to the moment of the answer) at the first successful answer.

Its rules are the other two studies' rules, unchanged: the same frozen `JUDGE_RULES` (population,
two-hour freshness, point-in-time inputs, output, outcome and exclusions, the take-all, no-trade
and matched-random controls, the bootstrap, the looks at 60 and 150 resolved calls over at least
15 sessions with their thresholds, the look timing, the 10% to 90% take-rate band, pass, fail and
consequence), prompt version `ai-judge-prompt-v1` and feature version `ai-judge-features-v1`. One
model, no fallback inside the study, and its evidence is never mixed with another model's. It
comes last in the fixed order, so it never takes calls from the studies registered before it.
Nothing changes automatically: a pass only makes an AI filter eligible for a future campaign that
the owner starts under its own preregistered rules.

## Operational notes (all studies; no rule changes)

These change how often a model is asked, never what counts as an answer, how an outcome is scored
or how a look is taken. The configuration hashes of the two earlier studies are unchanged.

1. **Resting models.** The helper keeps a shared record of each free model's recent attempts
   (`ai_model_health`, `lib/ai-free/health.ts`). A model whose last attempts failed without an
   answer (not found, busy, rate limited, network, unreadable reply, or a timeout after at least
   15 seconds) rests before it is asked again: 15 minutes after one failure, doubling with each
   failure in a row, at most six hours. One answer clears it. While a study's model rests, the
   study is not asked in that pass: nothing is claimed, so no attempt is used up, and a decision
   can still be asked later inside its two-hour window. As before, a decision that is not
   answered inside its window has no call in the study.
2. **Probation.** DeepSeek V4.1 Flash is on probation: no chain (coach notes, the weekly
   proposal, Ask the AI) asks it until it has answered once. A 30-second failure would otherwise
   take most of a 55-second pass.
3. **The probe is a fresh check.** A waiting study's probe asks its model even when a memory or
   the health record says it is resting. Before, a "not found" remembered from another call could
   make the probe record "all-unavailable" without asking. It now allows up to 512 output tokens
   instead of 64, so a model that reasons before it answers can reach its one word, and it waits
   at most 20 seconds. The study still starts only at a successful, non-empty answer.
