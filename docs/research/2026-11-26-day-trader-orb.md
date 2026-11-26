# Day Trader skill's opening-range rule as a Lab method (2026-11-26)

## What changed

`lib/strategies/day-trader-orb.ts` adds `day-trader-orb`, the opening-range rule from
the Day Trader skill pack (github.com/Jakeschincariol/day-trader-skill, MIT, commit
`3d0f4ef`; skills `trader-entry` and `trader-exit`). The pack itself has been in
`.claude/skills/` since 2026-11-12. This puts its rule into the app, on Aegis's own
bars, engine, fills and costs, so it can be run in the Lab and measured.

The rule, as the skill writes it: the opening range is the first 15 minutes (the
09:30, 09:35 and 09:40 bars); the trigger is the first completed 5-minute bar after
it that CLOSES strictly above the range high, once per day; long only; stop at the
range's midpoint; target 2R; optional volume check off. On Aegis the last trigger is
the 15:15 bar (the skill allows to 15:30) because Aegis is flat by 15:25 (the skill
by 15:55), and a range with a missing bar is not traded.

It is a different rule from Aegis's own `orb` (30-minute range, both sides, stop at
the far side, 1-point buffer), which was measured `no-edge` on 2026-10-18 and moved to
refuted. So it gets its own id and its own test and inherits neither verdict.

## Research-code revision

Adding a file to `lib/strategies` changes the research code hash
(`c933481b…` → `b2ae554d…`, pinned in `tests/research-code-pin.test.ts`). This is a
deliberate revision. On 2026-11-26 no paper release was active or on probation, so
nothing pauses; forward evidence restarts at zero, which only touches streams that are
already refuted. Standing: `day-trader-orb` is listed as unmeasured in
`research-standing.json`, so the weekly auto-benchmark (Sunday 05:00 UTC) measures it
against matched random entries with its registered decision rule. Nothing else is
re-measured: the other methods are refuted, not unmeasured.

## Preview (NOT a registered trial)

Before the registered test, a read-only replica of the engine's rules was run in SQL
on the Databento archive (2019-05-06 to 2026-09-23, 1,807 full sessions per market):
next-bar-open fills, one tick slippage (1.5 ticks in the first and last half hour),
gapped stops filled at the open, stop first when a bar touches both, flat at 15:25,
$2.40 a round trip, trades over the $160 risk cap or under a 2-point stop skipped.
On the 60-day MES fixture the replica takes the same 37 trades with the same exits as
`runBacktest`; its R values differ slightly (it divides by the planned stop distance
without slippage). Random control: 200 iterations, each trade's stop distance and 2R
target applied, long, at a random 09:50–15:20 bar on a random archive day.

| market | trades | win % | avg net R | profit factor (1 lot, net) | random avg net R (p5–p95) | random PF (mean / p95) | percentile vs random |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| MES | 1,309 | 38.9 | −0.042 | 1.04 | −0.102 (−0.154 to −0.056) | 0.85 / 0.94 | 97.5 |
| MNQ | 1,058 | 40.1 | +0.017 | 1.04 | −0.026 (−0.084 to +0.024) | 0.97 / 1.08 | 91.0 |

Read it plainly: on MES it loses less than random entries do, but it still loses in R
terms; on MNQ it is inside the random range. By year the profit factor swings from
0.82 to 1.38 with no steady side. Under the auto-benchmark's rule (every all-years
cell at or above the 95th percentile) MNQ at 91 would make this `no-edge`, but the
registered run on the real engine decides, and its per-year cells are stricter. Do not
tune it on these numbers: that would be fitting to the archive.
