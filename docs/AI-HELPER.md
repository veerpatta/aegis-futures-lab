# Free AI helper (NVIDIA)

The bot itself never needs AI: its engine, virtual account and learner run without it. The AI
helper adds three things on NVIDIA's free API, at no cost:

1. **AI second opinion** — a preregistered evaluation. For each new decision of the active
   learner campaign, a model reads the facts known at that moment and says take or skip, how
   sure, and why. The answer is recorded before the result is known and never changed, then
   scored against "take every idea", random picks and "no trade" after costs. It never trades
   and never changes the account. Rules: `docs/research/2026-11-07-ai-second-opinion-preregistration.md`.
2. **Coach notes** — a plain-English story for each finished decision and a short recap of the
   trading day, for the owner. Every number in a note must come from the record
   (`lib/ai-coach/validate.ts`), or the app shows its own sentence instead.
3. **Ask the AI** — the owner's research assistant (`POST /api/ai/research`) answers from the
   bot's records on the free provider when paid AI is off.

## Models

Asked in this order (`lib/ai-free/nvidia.ts`, override with `AEGIS_FREE_AI_MODELS`):

| Model | Status on 2026-11-06 with the owner's key |
|---|---|
| `moonshotai/kimi-k3.1-pro` (what the owner asked for) | Not on the API yet: NVIDIA serves it in its web playground only (404). |
| `moonshotai/kimi-k2.6` | Listed, but "not found for account" (not served to free accounts). |
| `nvidia/nemotron-3-ultra-550b-a55b` | **Works**, about 10-20 s a request. |
| `google/gemma-4-31b-it` | **Works**, about 5-10 s a request. |

A model that answers "not found" is skipped for six hours. **Kimi takes over by itself** the day
NVIDIA enables it: coach notes and Ask use the first model that answers, and the Kimi K3.1 Pro
second-opinion study (`ai-judge-kimi-k3.1-pro-v1`) is probed at most every six hours and starts
at its first answer. The Nemotron study (`ai-judge-nemotron-ultra-v1`) runs from registration.
The two studies never mix evidence.

## NVIDIA's free terms, and how the helper respects them

NVIDIA's API Trial Terms of Service (checked 2026-11-06):

- free, rate limited (about 40 requests a minute, often less; a 429 carries no retry hint), no
  card on file, so it **cannot bill**;
- for **trial and evaluation, not production**; generated content may **not be made available
  to others**; NVIDIA **may use inputs and outputs** to improve its models; NVIDIA may change or
  end the service at any time.

So:

- the second opinion is an evaluation study;
- **AI-written words are shown only to the signed-in owner** (`GET /api/ai/owner`); the public
  scoreboard (`GET /api/ai/scoreboard`) shows only numbers our own code computes;
- only market facts and the bot's own records are sent, nothing personal;
- if NVIDIA ends the free API, the helper stops and nothing else changes.

## How it runs

```
signal-engine.yml  run (engine + learner tick)  ──success──▶  ai-helper job
                                                               │ GitHub OIDC token (audience aegis-ai-helper)
                                                               ▼
                                        Vercel POST /api/ai/run (lib/ai-auth/github-oidc.ts)
                                          1. second opinion on new decisions (≤ 2 h old)
                                          2. probe a waiting study's model (≤ every 6 h)
                                          3. coach notes for finished decisions
                                          4. day recap (when the day's facts change, ≤ hourly)
```

- **No secret is stored.** The route accepts only a GitHub-signed OIDC token for
  `veerpatta/aegis-futures-lab`, workflow `signal-engine.yml`, ref `refs/heads/main`, event
  `schedule` or `workflow_dispatch`.
- At most 4 AI calls a pass; no new call starts after 40 s. The job always exits 0: an AI
  outage never fails the engine. Its log line shows counts only (the log is public).
- **Data**: `ai_judge_studies` (write-once registration; one allowed change, waiting → active),
  `ai_judge_calls` (append-only claims, answers, errors and probes; one final answer per study
  and decision), `ai_notes` (append-only; accepted or rejected). The browser roles cannot read
  them. The `aegis_ai` role (the `AI_DATABASE_URL` login) reads only the learner columns it needs.

## Settings (Vercel environment)

| Variable | Meaning |
|---|---|
| `NVIDIA_API_KEY` (or any variable whose value starts with `nvapi-`) | The free key. The helper reports the variable's **name**, never the value. |
| `AEGIS_FREE_AI=off` | Switches every free AI call off. |
| `AEGIS_FREE_AI_MODELS` | Comma list overriding the model order (coach and Ask; each study keeps its own model). |
| `AI_DATABASE_URL` | Already set for the research assistant; the helper uses the same restricted login. |

Paid OpenAI stays off unless `AEGIS_ALLOW_PAID_AI=true` (`lib/ai-cost/paid-ai.ts`).

## Turning it on (once)

1. Apply `db/migrations/20261107_ai_helper.sql` with the owner role, in one transaction. This
   registers both studies; the Nemotron study's clock starts at that moment.
2. Merge to `main` (Vercel deploys the routes; the next engine pass runs the `ai-helper` job).

## Checking it works

- `GET https://aegis-futures-lab-khaki.vercel.app/api/ai/status` →
  `{"freeAi":"on","keyFound":true,"keyName":"…","models":[…],"database":true}`.
- The next `signal-engine` run shows an `ai-helper` job whose log prints
  `AI helper: {"status":"ok",…,"judge":{"decided":…},"coach":{…}}`.
- SQL: `SELECT kind, count(*) FROM ai_judge_calls GROUP BY kind;` and
  `SELECT kind, status, count(*) FROM ai_notes GROUP BY 1, 2;`.
- `GET /api/ai/scoreboard` → per study: calls, resolved, taken, skipped, AI result vs take-all,
  random percentile and the verdict ("too-early" until 60 resolved calls over 15 sessions).

## Switching it off

Set `AEGIS_FREE_AI=off` on Vercel (takes effect on the next request), or remove the key. The
studies' records stay; nothing else in the app changes.
