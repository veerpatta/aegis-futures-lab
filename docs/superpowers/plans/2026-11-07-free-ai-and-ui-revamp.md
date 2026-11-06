# Free AI helper and a simpler app (2026-11-07)

Plain version for the owner first; design and contracts after. Nothing here costs money or
touches real money.

## What we found about "Kimi 3.1 Pro" on NVIDIA

Checked on 2026-11-06 with the owner's own key (stored for testing as a network secret of the
cloud environment, never printed):

| Model on NVIDIA's free API | With the owner's key |
|---|---|
| Kimi K3.1 Pro (`moonshotai/kimi-k3.1-pro`) | **Not on the API yet.** NVIDIA lists it for its web playground only ("API access … not available yet"); the API answers 404. |
| Kimi K2.6 (`moonshotai/kimi-k2.6`) | Listed, but "Not found for account": not served to free accounts. |
| Kimi K3 | Retired on 2026-10-15 (410). |
| **Nemotron 3 Ultra 550B** (`nvidia/nemotron-3-ultra-550b-a55b`) | **Works.** About 11 s a request; clean JSON; NVIDIA's own model. |
| **Gemma 4 31B** (`google/gemma-4-31b-it`) | **Works.** About 5-9 s; clean JSON. |
| MiniMax M3.1 Flash, Mistral Large 4 | Worked once, then "upstream request failed" (busy). |
| DeepSeek V4.1 Flash, GLM 5.3 Flash, GPT-OSS 20B | 502 after 30 s (busy). |

Free terms that shape the design (NVIDIA API Trial Terms of Service):

- Rate limits instead of credits ("up to 40 requests a minute", often less; 429 with no retry
  hint). No card on file, so it cannot bill.
- **Trial and evaluation only, not production**; generated content may not be "made available
  to others"; NVIDIA may use inputs and outputs to improve its models; the service can change
  at any time.

So the helper (1) treats every AI answer as an **evaluation**, (2) shows AI-written words
**only to the signed-in owner** (the public site shows only numbers our own code computes),
(3) sends only market facts and the bot's own records (nothing personal), and (4) prefers
Kimi K3.1 Pro the moment NVIDIA switches its API on, then Kimi K2.6, then Nemotron 3 Ultra, then
Gemma 4.

## Brainstorm: how a free AI could help the bot

Honest starting point: none of the methods that feed the bot ideas has beaten random entries.
An AI cannot add an edge by wishing; it can only help by **skipping the worse ideas**, and that
must be proven on fresh trades before it is allowed to touch the account.

| # | Idea | Verdict |
|---|---|---|
| 1 | **AI second opinion on every idea** — for each idea the bot decides, the AI reads the facts known at that moment (price move today, last hour, distance from average, volatility, trend, the method, its stop and target) and says take or skip, how sure, and why. Written before the result is known, never changed, scored against "take every idea", random picks and "no trade" after costs. | **Build now.** The only honest road from "AI" to "more profit". |
| 2 | **AI coach notes** — a plain-English story for each finished trade and a short daily recap, for a reader who has never traded. Every number in the text must come from the record, or the app shows its own wording instead. | **Build now** (owner only, per NVIDIA's terms). |
| 3 | **Ask the AI** — the existing research assistant ("Why did the bot lose today?") answers from the bot's records, now free. | **Build now** (owner only; it already exists, paid AI is off). |
| 4 | AI as one input of the learner's own model (its confidence becomes a feature). | **Later**: needs a new campaign's rules; only after #1 shows a signal. |
| 5 | AI weekly loss review that proposes hypotheses for the research ledger. | **Later**: a hypothesis is not evidence; it must go through the preregistered tests. |
| 6 | Let the AI tune the methods' settings. | **No.** The research brief forbids tuning a method that does not beat chance; that is how backtests lie. |
| 7 | Let the AI place trades directly. | **No.** Unproven; it would bypass the adoption checks that protect the account. |
| 8 | Headline/news reader. | **No for now.** Needs a news feed (cost or licence); the fixed news pause already exists. |

How #1 can become profit, step by step: the study collects calls → after 60 and 150 finished
calls it is judged by rules written today → only a pass lets the owner start a campaign in
which the bot skips the ideas the AI rejects. Nothing switches automatically.

## Brainstorm: a simpler app

What a non-trader asks, in order: *Is it working? How is my virtual money? What did it do and
why? Is it getting smarter? What is the market doing?* The current screens answer research
questions first (an 8-step funnel opens Trades; the same account box appears on three tabs;
Today is four phone screens long).

| # | Idea | Verdict |
|---|---|---|
| 1 | One-glance **Today**: a status line, the balance, today in plain words, the last three trades, learning progress, two price tiles, the next big news. About two phone screens. | Build |
| 2 | **One account box** only (Today); other tabs show a one-line balance. | Build |
| 3 | **Trades** as a clean list with filters (All, Taken, Skipped, Open) and a summary line; the research funnel moves into a folded "Under the hood" section. | Build |
| 4 | **Trade page as a story**: result, plain story, the price ladder, a timeline, the AI's second opinion, then folded details (costs, rules, saved values). | Build |
| 5 | **Learn as a progress tracker**: results collected toward the next check, who is in charge, the AI scoreboard, change history; research numbers folded. | Build |
| 6 | **More** regrouped: Records, Help, Settings, Advanced. The header keeps the brand and the money-hiding eye; the ET/IST switch lives in Settings. | Build |
| 7 | Shared building blocks (card, section header, stat, list row, status dot, fold) with one spacing scale, so pages stop looking assembled from different kits. | Build |
| 8 | Wide screens: two columns on Today and Learn instead of a stretched phone column. | Build |
| 9 | A light theme, new charts, renamed trading words. | No: the design rules keep dark only, and the glossary words are pinned to the manual. |

## Design: the AI helper

**Provider** (`lib/ai-free/`): OpenAI-compatible `POST https://integrate.api.nvidia.com/v1/chat/completions`.
Key from the server environment (`NVIDIA_API_KEY` or any variable whose value starts with
`nvapi-`; the name is reported, never the value). A model chain with an availability memory:
a "not found" model is skipped for six hours; a busy model (429/5xx/timeout) falls through to
the next. Reasoning text is ignored (`reasoning_content`/`reasoning`, `<think>` stripped).
Zero cost: free endpoint, no billing method; `AEGIS_FREE_AI=off` switches everything off.

**AI second opinion study** (`lib/ai-judge/`), preregistered in
`docs/research/2026-11-07-ai-second-opinion-preregistration.md` before the first call:

- One study per model, so a model change never mixes evidence: `ai-judge-nemotron-ultra-v1`
  (active from registration) and `ai-judge-kimi-k3.1-pro-v1` (starts at the first successful
  Kimi K3.1 Pro answer; probed at most every six hours).
- Population: every decision of the active learner campaign recorded after the study started,
  taken or skipped, paused methods included (as the v3 rules do).
- Inputs: only facts with timestamps at or before the decision's information cutoff — the
  idea, the learner's saved features, and context computed from `bars_5m` bars that ended by the
  cutoff. Called within two hours of the decision being recorded; later calls are not made.
- Output: `{decision: take|skip, confidence: 0-100, reason}`, write-once.
- Outcome: the learner's own one-contract shadow result for that decision (after costs).
- Scoreboard: AI picks vs take-all vs no-trade, matched random picks (same count), the
  per-idea difference with a session bootstrap. Looks at 60 and 150 resolved calls (and at
  least 15 sessions); pass rules in the preregistration. A pass only makes the AI filter
  eligible for a future campaign that the owner starts.

**Coach** (`lib/ai-coach/`): notes for finished trades and a daily recap from a facts object.
Numbers are checked against the facts; anything else is rejected and the app's own sentence
is shown.

**Running it**: a separate `ai-helper` job in `signal-engine.yml` (after a successful engine
pass) asks GitHub for an OIDC token and calls `POST /api/ai/run` on Vercel. The route accepts
only a token signed by GitHub for this repository's `signal-engine.yml` on `main`, so no new
secret is needed. Each run makes at most a few AI calls and stops starting new ones after 40 s.
An AI outage never fails or delays the engine.

**Data**: `ai_judge_studies` (write-once registration), `ai_judge_calls` (append-only, one
per study and decision), `ai_notes` (one per subject and facts hash). Not readable by the
public Data API; the restricted `aegis_ai` role gets exactly the reads and inserts it needs.

**API contracts used by the screens**:

- `GET /api/ai/scoreboard` (public, cached 5 min) → `{ updatedAt, available, studies: [{ id,
  label, model, status: "active"|"waiting-for-model", startedAt, calls, resolved, taken,
  skipped, sessions, aiNet, takeAllNet, randomPercentile, delta: {est,lo,hi}|null,
  verdict: "too-early"|"inconclusive"|"pass"|"fail", nextLook }] }` — numbers only.
- `GET /api/ai/owner` (owner sign-in) → `{ calls: [{ decisionKey, studyId, model, decision,
  confidence, reason, calledAt }], notes: [{ kind: "trade"|"day", subject, text, model,
  createdAt }] }`.
- `POST /api/ai/research` (owner sign-in) — the existing assistant, now on the free provider
  when paid AI is off.

## Design: the screens

| Screen | New layout (top to bottom) | Moved or removed |
|---|---|---|
| Today `/` | Status line (on time / closed / late) · balance card (balance, today, since start, small balance line) · today in plain words (AI for the owner, app wording otherwise) · last three trades · learning progress + AI scoreboard line · two price tiles · next big news | Account journey grid, simulation notes, step-by-step checks (to Learn → Under the hood), method ideas list (to More → Ideas), tour card (to a slim banner) |
| Trades `/trades` | One-line balance · summary (trades, wins, losses, total) · filter chips · clean trade rows (market, direction in words, method, time, result, AI call for the owner) | 8-step funnel, paused-method practice, check timeline (to a folded "Under the hood") |
| Trade `/trades/[id]` | Result · plain story · price ladder · timeline · AI second opinion · folded details | Long evidence blocks folded |
| Learn `/brain` | Progress to the next check · who is in charge · AI scoreboard · change history · Ask the AI (owner) · folded under-the-hood sections | Duplicate account card; research and owner tools folded |
| Chart `/markets` | Unchanged chart; tidier header; "why no idea" as two plain lines; next three news items | — |
| More `/more` | Records (Ideas, Calendar, Journal) · Help (Guide) · Settings (time zone, hide amounts) · Advanced (Lab, Diagnostics, Data, Historical practice) | — |

Honesty rules stay: too little evidence is amber, never red; no rate without its `n`; the
virtual-money and delayed-data warning stays visible on every tab.

## Rollout

1. Build (AI helper and screens in parallel), unit tests, type check, build, e2e.
2. Guide, `docs/USER-MANUAL.md` and the PDF updated in the same change.
3. Pull request → CI → merge (the owner asked to deploy) → apply the migration (registers the
   studies) → watch the first `ai-helper` run → check the screens on phone and desktop.
