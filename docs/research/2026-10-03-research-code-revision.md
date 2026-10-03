# Research-code revision — 3 October 2026

Paper only. Delayed data. Nothing here touches real money.

## What changed

This is a deliberate change to files covered by the research code hash
(`scripts/engine/research-code.ts`). The hash moves from
`affc0974…bd6de6` to `702840b7…0a8b46`, pinned in `tests/research-code-pin.test.ts`.

1. **The practice account only takes trades the strategy's own replay took.**
   `paper-broker.ts` used to open every recorded intent that fitted its risk
   budget, with a hardcoded target (1.5R for rsi-context, otherwise 2R). It
   ignored the strategy's own daily trade and loss limits, its one-position rule
   and its $50 risk cap, so practice P&L could describe different trades from
   the forward evidence it is judged by. It now fills only observations whose
   payload the replay has filled in (`entryPrice`, `target`, `qty`) and uses that
   target. An intent the replay refused is recorded as "Skipped: the strategy's
   own rules did not take this trade".

2. **Intents the rules never took are closed out.** On 3 October, 8 of the 10
   forward intents recorded since 25 September had no exit (verified read-only
   on Neon: vwap-pullback MES 1 of 1, MNQ 3 of 4; opening-continuation MES 1 of
   2, MNQ 3 of 3) and never would: each
   needed $72–$230 of risk for one contract, the replay caps risk at $50, so the
   replay never took them and nothing closed them. `research-observer.ts` now
   closes such an intent once its session has ended (15:25 ET plus 90 minutes),
   with `pnl: null`, `untaken: true` and a note — under any code hash, so the
   eight stranded on the old hash are closed on the first pass after deploy. A null pnl keeps it out of every
   forward count (`candidate_progress`, `paper-release.ts`), exactly as before;
   it simply stops looking open.

3. **The observer no longer skips decision bars.** It decided on the last
   finished bar of each 15-minute pass only, so about two of every three 5-minute
   decision bars were never observed and the 60-trade / 20-day bar took roughly
   three times as long to reach. `observeResearch` gains `catchUpSec` (default 0,
   the legacy behaviour); the live call in `run-live.ts` opts in to 1,800 seconds.
   Every finished bar in that window is decided on, oldest first, each seeing only
   the bars up to itself, with the same frozen rules. A decision recorded after
   its entry bar printed carries `late: true` for transparency; the replay fills
   it the same way either way.

4. **Standing.** `ema-cross`, `orb`, `vwap-reversion` and `bollinger-breakout`
   had no random-entry benchmark but fell through `standingOf()` to "measured".
   They are now UNMEASURED (amber, "not tested yet"). The list lives in
   `lib/strategies/research-standing.json`, which the hash does not read, so a
   later verdict moves a strategy without restarting evidence again.

No strategy rule, parameter, cost assumption or risk limit changed. The golden
parity tests are unchanged and pass.

## The cost, stated plainly

- **Forward evidence restarts at zero.** Every observation key and every
  release is tied to the code hash. The forward sample on the old hash was tiny
  (the two intents that closed, plus the eight that never would), and no paper
  release has ever existed, so nothing live is interrupted.
- **Bot progress shows the old measurement until it is re-run.**
  `candidate_progress` reads forward rows under the hash of each candidate's
  latest measurement. Until `registered-research-v2` is re-run in "development"
  mode on the new hash (a manual workflow; it needs the owner's go-ahead), the
  Bot screen's progress meters keep counting under the old hash. The
  confirmation step must NOT be re-run without the owner: it may need a paid
  Databento purchase.

## Left for the owner to decide

- **The $25 / $50 risk caps.** With these caps one contract of most current
  candidates does not fit, so the replay rarely takes a trade. Raising them is a
  policy decision in a hashed file (`lib/paper/policy.ts`), not a bug, and this
  revision does not touch it.
- **Re-running the development measurement** on the new hash, as above.

## Verification

- `tests/research-revision.test.ts`: catch-up indexes (legacy default, window,
  bounds), untaken close-out timing (flatten time, grace, Globex evening), and
  the classics' standing.
- `tests/research-code-pin.test.ts`: the new hash, deliberately.
- Full unit suite, type check and production build pass. The engine was not run
  locally (`.env.local` points at production Neon and there is no dry-run mode);
  the first scheduled pass after deploy is the live check.
