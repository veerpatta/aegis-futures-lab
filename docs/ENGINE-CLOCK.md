# The engine clock

Plain version: the bot needs a reliable timer. GitHub's free timer stopped keeping time on
2 November 2026. A free Neon timer now does the job, once you give it one GitHub key. Nothing
here costs money or touches real money.

## What broke

The engine (delayed prices → method ideas → published batch → virtual account) runs in GitHub
Actions on an every-15-minutes schedule. Until 2 November it ran 70-93 times every weekday.
From 2 November at about 12:47 UTC GitHub started it only every 4-8 hours (2-4 runs a day), for
every scheduled workflow in this repository. GitHub's documentation says scheduled runs can be
delayed or dropped under load, and many repositories reported the same in late 2026
([example](https://github.com/orgs/community/discussions/210888)). The app then showed
hours-old prices, "waiting for usable data" and "a check needs attention".

The learner's own Neon timer kept firing every 15 minutes the whole time, so Neon keeps the time
and GitHub does the work.

## How it works

- Neon Function `aegisclock` (`functions/aegisclock`, code in `lib/clock/handler.ts`) runs on
  Neon's scheduler: every 15 minutes at :06/:21/:36/:51 from 05:00 to 21:59 UTC on weekdays,
  hourly overnight, and hourly at the Sunday reopen (`scripts/clock/triggers.json`).
- Each time, it asks GitHub to start `signal-engine.yml` (a manual start, which GitHub runs at
  once). The engine run then fetches prices, records ideas, publishes the batch and runs the
  virtual account, exactly as before.
- Every attempt is written to the public table `engine_clock` (time, outcome, GitHub's answer;
  never the key). The watchdog quotes it when the engine looks stale.
- GitHub's own slow schedule stays in place as a fallback.

**Cost: zero.** Neon Free includes 1 million function calls and 10 active hours a month; the
clock uses about 2,300 calls of well under a second each. GitHub Actions minutes are free on a
public repository. The clock fires one minute before the learner's own :07 check, so the
database wakes once per quarter hour for both, which keeps it well inside Neon Free's 100
compute-hours a month.

## Turning it on (once, about 3 minutes)

GitHub only lets a caller with a key start a workflow. Make a key that can do nothing else:

1. **Make the key.** Open
   [this pre-filled form](https://github.com/settings/personal-access-tokens/new?name=Aegis+engine+clock&description=Lets+the+Neon+clock+start+the+Aegis+engine+every+15+minutes&target_name=veerpatta&expires_in=366&actions=write).
   Under **Repository access** choose **Only select repositories** and pick
   **aegis-futures-lab**. Check that **Permissions → Actions** says **Read and write** (the
   link sets it). Click **Generate token** and copy it.
2. **Store it.** Open
   [the new-secret page](https://github.com/veerpatta/aegis-futures-lab/settings/secrets/actions/new).
   Name: `ENGINE_DISPATCH_TOKEN`. Paste the key as the value. Click **Add secret**.
3. **Start the engine once.** Open
   [signal-engine](https://github.com/veerpatta/aegis-futures-lab/actions/workflows/signal-engine.yml),
   click **Run workflow**, then **Run workflow**. This copies the key into the database's private
   area, where only the clock can read it.

Within 15 minutes the Today screen's timer line reads "on time".

**Never paste the key anywhere else**: not in chat, an issue or a file. It can only start or
stop this repository's workflows, but treat it like a password.

## Renewing, pausing or removing it

- The key above lasts 366 days. When it expires the clock logs "GitHub refused its key", the
  watchdog says so, and the Today screen shows the timer as slow. Repeat steps 1-3.
- To stop the clock without deleting anything, set the secret's value to `off` and run step 3.
- To remove it entirely, delete the token on GitHub
  ([your tokens](https://github.com/settings/personal-access-tokens)).

## Who can read the key

Only the database owner role, which Neon gives its functions. It sits in the private schema
`aegis_private`, which the Data API does not expose and the browser roles and the AI role cannot
read (`db/migrations/20261106_engine_clock.sql`). The engine workflow copies it there with
`scripts/clock/sync-token.ts`, which never prints it.

## Handing the learner over to v3

The v3 campaign rules ([preregistration](research/2026-11-06-learner-v3-preregistration.md))
let the learner see paused methods' ideas, take one MNQ contract up to $150 of risk, and count
promptly processed decisions as fresh evidence, so a candidate can finally be adopted. They
apply only to a NEW campaign. The learner's Neon Function (`aegisexp`, build `f194c9a`) knows
v1/v2 only and cannot be redeployed from a cloud session, so GitHub runs the learner from then
on. Do these in order, after this change is merged:

1. Apply `db/migrations/20261106_learner_v3_runner_fence.sql`. It refuses that old build's runs
   for any v3 campaign, so a forgotten trigger can never act for one.
2. In Neon (project aegis-futures-lab → Functions → Triggers) **disable** `aegisexp-tick-weekdays`,
   `aegisexp-tick-sunday-open`, `aegisexp-learn-nightly` and `aegisexp-review-weekly`, and
   **enable** `aegisclock-learn` and `aegisclock-review` (and `aegisclock-engine-day` and
   `aegisclock-engine-night` if they are not on yet).
3. GitHub → Actions → **experiment-control** → Run workflow: action **stop**, reason
   "Handover to the v3 rules of 2026-11-06". Learner-2 must have no open trade.
4. Same workflow: action **start**, reason "v3 rules: paused ideas, one MNQ contract up to $150,
   prompt delayed decisions count as fresh". This registers learner-3 at $10,000. Lifetime totals
   keep learner-1 and learner-2, losses included.
5. Check: the next engine run's log ends with a learner tick for learner-3, and Trades shows
   "Campaign 3".

Until the clock key exists, GitHub's slow schedule still runs the engine and the learner a few
times a day. Decisions are then processed hours late and stay labelled replay, which is honest
but cannot count toward adoption.
