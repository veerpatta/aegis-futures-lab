# Free AI helper (NVIDIA)

The bot itself never needs AI: its engine, virtual account and learner run without it. The AI
helper adds four things on NVIDIA's free API, at no cost:

1. **AI second opinion** — a preregistered evaluation. For each new decision of the active
   learner campaign, a model reads the facts known at that moment and says take or skip, how
   sure, and why. The answer is recorded before the result is known and never changed, then
   scored against "take every idea", random picks and "no trade" after costs. It never trades
   and never changes the account. Rules: `docs/research/2026-11-07-ai-second-opinion-preregistration.md`.
2. **AI research ideas** — once a week the AI reads statistics of the learner's finished ideas
   and proposes up to three simple **skip rules** in a tiny rule language
   (`lib/ai-ideas/dsl.ts`). Each rule is tested only on decisions made **after** it was proposed,
   against take every idea, random skips and no trade, with stricter thresholds because up to
   three run at once. A pass only makes the rule eligible for a future campaign the owner
   starts. Rules: `docs/research/2026-11-07-ai-ideas-preregistration.md`.
3. **Coach notes** — a plain-English story for each finished decision, a short recap of the
   trading day and the week's research summary, for the owner. Every number in a note must come
   from the record (`lib/ai-coach/validate.ts`), or the app shows its own sentence instead.
4. **Ask the AI** — the owner's research assistant (`POST /api/ai/research`) answers from the
   bot's records on the free provider when paid AI is off.

## Models

Asked in this order (`lib/ai-free/nvidia.ts`, override with `AEGIS_FREE_AI_MODELS`):

| Model | Status on 2026-11-07 with the owner's key |
|---|---|
| `moonshotai/kimi-k3.1-pro` (what the owner asked for) | Not on the API yet: NVIDIA serves it in its web playground only (404). |
| `moonshotai/kimi-k2.6` | Listed, but "not found for account" (not served to free accounts). |
| `nvidia/nemotron-3-ultra-550b-a55b` | **Works**: second opinion about 19 s, notes 12-16 s, a weekly proposal about 49 s (it reasons first). |
| `google/gemma-4-31b-it` | **Works**: about 3-6 s for notes and second opinions, about 19 s for a proposal. |

- **Streaming.** NVIDIA's gateway answers 502 when a non-streamed answer takes about 30 s
  (measured 2026-11-07), which a reasoning model often does; every call is streamed, which keeps
  the connection alive and does not change the answer.
- **Kimi takes over by itself** the day NVIDIA enables it: coach notes, the proposal and Ask use
  the first model that answers, and the Kimi K3.1 Pro second-opinion study
  (`ai-judge-kimi-k3.1-pro-v1`) is probed at most every six hours and starts at its first answer.
  The Nemotron study (`ai-judge-nemotron-ultra-v1`) runs from registration; the two studies never
  mix evidence.
- **"Not found" memories.** The chain (coach, proposal, Ask, Kimi probe) skips a "not found"
  model for six hours. Each single-model study keeps its own memory for at most 15 minutes, so a
  coach 404 can never silence a study for hours.
- **The weekly proposal** asks Gemma 4 before Nemotron (after Kimi): Nemotron's 49 s answer does
  not fit the 40 s per-call cap inside a 60 s function. The model is recorded with each rule.
- **If Kimi K3.1 Pro arrives slow** (Moonshot's own API has shown minutes to a first answer),
  calls that take over 40 s time out here; its study would then collect errors, not answers.
  Running the helper inside a GitHub Actions job (longer limits) would need the key stored there
  too. Decide when it happens.

## NVIDIA's free terms, and how the helper respects them

NVIDIA's API Trial Terms of Service (checked 2026-11-06):

- free, rate limited (about 40 requests a minute, often less; a 429 carries no retry hint), no
  card on file, so it **cannot bill**;
- for **trial and evaluation, not production**; generated content may **not be made available
  to others**; NVIDIA **may use inputs and outputs** to improve its models; NVIDIA may change or
  end the service at any time.

So:

- the second opinion and the ideas are evaluation studies;
- **AI-written words are shown only to the signed-in owner** (`GET /api/ai/owner`: the second
  opinion's reasons, the notes, and each rule's name, reason and conditions); the public
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
                                          3. take any due look and store it once
                                          4. coach notes for finished decisions, day recap
                                          5. ideas: take due looks, retire, weekly proposal
```

- **No secret is stored.** The route accepts only a GitHub-signed OIDC token for
  `veerpatta/aegis-futures-lab` (repository id 1304384083, owner id 222136377), workflow
  `signal-engine.yml`, ref `refs/heads/main`, event `schedule` or `workflow_dispatch`.
- **Time.** The clock starts when the request arrives (before the token is checked). At most 4
  AI calls a pass, at most 2 per study, studies in a fixed order; no call starts after 40 s or
  with under 8 s left before 55 s, and the deadline holds across the whole model chain. The job
  waits 75 s at most and always exits 0: an AI outage never fails the engine. Its log line shows
  counts only (the log is public).
- **Answers.** Every attempt is claimed first; the first answer (also an empty or unusable one)
  is final; a provider failure may be retried while the two-hour window is open, three attempts
  at most; an attempt younger than 3 minutes with no answer or error is in progress and never
  doubled. A failure to save stops the pass instead of being logged as a provider error.
- **Looks** are frozen: ordered by when each decision was recorded, taken only when every
  decision in the window is final (and, for the second opinion, two hours after the window's
  last decision), then stored once in `ai_looks`. The scoreboard shows the stored verdict.
- **Data** (all private, RLS on, no browser grants; append-only and protected from TRUNCATE):
  `ai_judge_studies` (write-once; one change, waiting → active, now), `ai_judge_calls` (claims,
  answers, errors, probes; one final answer per study and decision, which the database refuses
  without a claim or after two hours), `ai_looks`, `ai_notes` (trade, day, week), and
  `ai_hypotheses` (rules; proposed now, at most three testing, one change: testing → retired,
  now). The `aegis_ai` role reads only the learner columns it needs. Every text saved is cleaned
  of NUL characters and broken characters and cut by whole characters.
- **Database time limits.** Each AI query is capped at 10 s on the client (`query_timeout`) and
  on the server (the migration sets `statement_timeout = 10s` on the `aegis_ai_app` login, as
  Neon's pooler refuses that setting at connection time).

## Settings (Vercel environment)

| Variable | Meaning |
|---|---|
| `NVIDIA_API_KEY` (or any variable whose value starts with `nvapi-`) | The free key. The helper reports the variable's **name**, never the value. |
| `AEGIS_FREE_AI=off` | Switches every free AI call off. |
| `AEGIS_FREE_AI_MODELS` | Comma list overriding the model order (coach and Ask; each study keeps its own model; the proposal keeps its own order). |
| `AI_DATABASE_URL` | Already set for the research assistant; the helper uses the same restricted login. |

Paid OpenAI stays off unless `AEGIS_ALLOW_PAID_AI=true` (`lib/ai-cost/paid-ai.ts`).

## Turning it on (once)

1. Apply `db/migrations/20261107_ai_helper.sql` with the owner role, in one transaction. This
   registers both studies (the Nemotron study's clock starts at that moment), creates the ideas,
   looks and notes tables, and sets the AI login's statement timeout. If `AI_DATABASE_URL` does
   not use the `aegis_ai_app` login, set the timeout on that login instead.
2. Merge to `main` (Vercel deploys the routes; the next engine pass runs the `ai-helper` job).

## Checking it works

- `GET https://aegis-futures-lab-khaki.vercel.app/api/ai/status` →
  `{"freeAi":"on","keyFound":true,"keyName":"…","models":[…],"database":true}`.
- The next `signal-engine` run shows an `ai-helper` job whose log prints
  `AI helper: {"status":"ok",…,"judge":{"decided":…},"coach":{…},"ideas":{"waiting":…}}`.
- SQL: `SELECT kind, count(*) FROM ai_judge_calls GROUP BY kind;`,
  `SELECT kind, status, count(*) FROM ai_notes GROUP BY 1, 2;`,
  `SELECT status, count(*) FROM ai_hypotheses GROUP BY 1;` and `SELECT * FROM ai_looks;`.
- `GET /api/ai/scoreboard` → `studies` (calls, resolved, taken, skipped, AI result vs take-all,
  random percentile, verdict, next look, why it waits) and `ideas` (tested, resolved, skipped,
  kept result vs take-all, random percentile, verdict, next look, why it waits). Verdicts stay
  "too-early" until a look's window is complete.
- The first proposal waits for 20 finished decisions across all learner campaigns (void
  outcomes carry no result); `ideas.waiting` says `too-few-finished` until then.

## Switching it off

Set `AEGIS_FREE_AI=off` on Vercel (takes effect on the next request), or remove the key. The
studies' and ideas' records stay; nothing else in the app changes.
