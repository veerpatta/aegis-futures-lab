# Bot repair plan (2026-11-06)

Plain version for the owner first; evidence and file names after. Nothing here costs money or
touches real money.

## What was wrong, in plain words

1. **The bot's timer stopped keeping time.** The bot is started by GitHub's free scheduler every
   15 minutes. On 2 November at about 12:47 UTC GitHub started running it only every 4 to 8
   hours. From then on the screens showed prices hours old, "Waiting for usable data" and "A
   check needs attention". This is on GitHub's side and affects many projects.
2. **The bot was not allowed to see most ideas.** When a method has a losing streak its "loss
   guard" pauses it, and the bot was never shown a paused method's ideas. From 16 to 30 October
   every method was paused, so the bot saw nothing for two weeks.
3. **Nasdaq micro ideas were "too risky".** The bot may risk $100 a trade. Nasdaq micro ideas
   usually need $100 to $145 of risk for even one contract, so almost every one was skipped,
   and skipped-for-risk ideas were not even used for learning.
4. **The bot could never prove it learned anything.** To let a new version take over, the rules
   need 60 "fresh" decisions. Since 8 October every decision was labelled "replay" (not fresh), so
   that count could never move. The Learn screen said so in small print.
5. **A wrong number on screen.** The price cards showed a 5-day change as if it were today's
   (for example −2.44% on a day that was +0.07%).
6. **The screens did not explain any of this.** Long pages of counters, little "why".

And one honest fact that no fix changes: **none of the methods the bot gets its ideas from has
beaten random entries** in years of tests. A bot that trades their ideas well can still lose
virtual money. What it can do is collect honest evidence and learn which ideas to skip.

## What is fixed now (in this change)

| Problem | Fix | Where |
|---|---|---|
| Timer | A free Neon timer starts the GitHub job on time every 15 minutes, once one GitHub key is stored. Deployed and waiting for the key | `functions/aegisclock`, `lib/clock/`, `docs/ENGINE-CLOCK.md` |
| Wrong % | Price change now uses yesterday's settle and says "today" | `lib/data/daily-change.ts`, `app/api/market/route.ts` |
| Hidden ideas, risk, learning dead end | New campaign rules (v3): sees paused methods' ideas, may take one micro contract up to $150, counts promptly processed decisions as fresh | `lib/experiment/prereg.ts`, `policy.ts`, `step.ts`, `delayed.ts`, `opportunities.ts`, `docs/research/2026-11-06-learner-v3-preregistration.md` |
| Screens | Today now says whether the timer is on time, why the bot has been quiet (from saved reasons), and folds the long check timeline | `lib/plain/timer.ts`, `components/widgets/TodayPulse.tsx`, `components/experiment/ExperimentCard.tsx` |
| Costs | Paid AI (OpenAI) is switched off unless the owner turns it on | `lib/ai-cost/paid-ai.ts` |
| Alerts | The watchdog's "engine stale" alert now names the timer's state and the fix | `scripts/engine/watchdog.mjs` |

The running campaign (learner-2) is unchanged: every change is tied to the new rules version,
and its 111 existing tests still pass.

## What the owner needs to do (about 5 minutes, once)

1. **Merge this change** on GitHub.
2. **Give the timer its key**: three steps in `docs/ENGINE-CLOCK.md` → "Turning it on" (make a
   key with a pre-filled link, store it as a secret, press Run workflow once).
3. **Allow the switch-over** to the v3 rules (done with Claude or by hand, steps in
   `docs/ENGINE-CLOCK.md` → "Handing the learner over to v3"): apply the safety fence, swap the
   Neon schedules, stop campaign 2, start campaign 3.

## What to expect afterwards

- Prices and ideas checked every 15 minutes; the Today timer line reads "On time".
- Roughly 2 to 4 ideas a trading day decided, most of them taken (October's rate), instead of
  about one a week.
- Learning examples at a few a day instead of 8 a month. The first candidate can train after a
  few weeks; a full review needs a few months. A candidate takes over only if it beats
  "take every idea" and random picks after costs on fresh evidence.
- Probably more virtual losses, because the ideas come from methods without an edge. That is
  the evidence, honestly recorded, not a malfunction.

## Cost

$0. GitHub Actions are free on a public repository. Neon Free cannot bill: it pauses at its
limits, and the timer is placed so the database wakes once per quarter hour for both jobs (about
45-75 of the 100 free compute-hours a month). Vercel Hobby is free. OpenAI stays off.

## Evidence

- Engine runs per weekday from `engine_runs`: 70-93 until 30 October; 51 on 2 November (last
  on-time run 12:47 UTC); 4, 4, 3 and 2 on 3-6 November. GitHub `signal-engine` run numbers are
  consecutive, so GitHub stopped creating scheduled runs; nothing failed.
- `bot_policy` rows 12, 13 and 15 paused every source by 16 October; row 18 resumed MNQ on
  30 October.
- `experiment_decisions` 31-35 (2-4 November): four of five ideas skipped as "risk-budget"
  ($104-$147 a contract).
- `lib/experiment/delayed.ts` passed `provenance: "replay"` for every delayed decision, while
  `freshWindow` (`lib/experiment/learning.ts`) counts only "prospective" ones.
- Yahoo `MES=F` meta on 2026-11-06, range 5d: `previousClose` 7383, `chartPreviousClose` 7574.5.
