# Historical study — preregistration (hist-study-2026-10-07)

Registered 2026-10-07, before any replay or evaluation. Source: the "Aegis historical
learning plan" (7 October 2026, pinned to commit 031b3fa). The executable form of every
rule below is `lib/history/rules.ts` (`HIST_RULES`); the study row in `history_studies`
stores that object, its hash and the full manifest, and database triggers refuse edits.
A change means a new study version, never an edit.

**Virtual only. $0.** No broker, no purchases, no paid data or AI, no new downloads.
Raw archive bars stay private; the screens show totals only.

## Purpose

Use the archive the project already holds to prepare a stronger paper learner — a small
take-or-skip filter over the frozen methods' ideas — then measure it on genuinely new
decisions as a shadow candidate inside the live experiment. Historical replay
contributes zero fresh sessions. The refuted methods are not tuned: the study filters
their ideas, it never changes a method parameter. If nothing beats the controls after
costs, the correct result is **No validated improvement yet**.

## History register (stage 1)

| Source | Coverage | Role |
|---|---|---|
| Databento MES/MNQ (`bars_5m`, source `databento`) | 2019-05-06 → 2026-09-23 23:55 UTC | The study's only price source; every read pins the source |
| Databento MGC/SI | 2019-05-06 → 2026-07-29 | Excluded: separate instruments |
| Yahoo MES/MNQ | 2026-05-12 → 2026-10-07 | Excluded; overlap with Databento compared for discrepancies only |
| `signals` (legacy ideas), `shadow_signals` | July → October 2026 | Audited and mapped to opportunity families; never used as labels (different feed) |
| `context_daily` (VIX) | 2025-07-23 onward | VIX feature missing for older examples — a recorded train/live mismatch |
| Personal journal, browser files | — | Never imported |
| Synthetic prices | — | Software tests only, separate lineage |

Three beginnings, never substituted for one another: code history 2026-07-17 (root
commit ac127ffa), market archive 2019-05-06, experimental learner 2026-10-07 (first
decision 09:25 UTC). The exact first production observation is an **unknown**; the
earliest engine run and the first legacy signal are recorded in the manifest as
evidence, not as a launch date.

The register stage writes the measured facts into the manifest: coverage per
source/symbol, the Yahoo–Databento overlap mismatch count, legacy totals, research-table
counts, the observation-lag percentiles and the context coverage.

## Permissions ledger

- **Databento archive:** owner-purchased; licence scope for automated training, storage
  and redistribution **not verified**. Read server-side only by this study; study tables
  are private (RLS on, no grants); the public view exposes totals only. **Open
  question for the owner:** the existing Data page already reads raw Databento bars
  through the public Data API — confirm the licence allows that, or restrict it. This
  study does not change that page.
- **Yahoo:** usage rights unverified; not used by this study.
- **Legacy records:** the app's own; audited, never relabelled.

## Prior-use map

| Period | Already used for |
|---|---|
| 2019-05-06 → 2026-07-29 | Development (Phase 1, research-v2 measurements) |
| 2026-07-30 → 2026-09-23 | The September confirmation — evaluated |
| 2026-09-24 → 2026-10-07 | Live engine forward period (Yahoo only, outside this scope) |

**No untouched historical period remains.** Every result in this study is labelled
development-exposed; the decisive test is the forward period after registration.

## Replay (stage 2)

- Chunk = one instrument and one month, plus 60 days of warm-up and a 2-day tail; only
  ideas whose entry falls inside the month belong to the chunk. ≤ 100,000 bars per read.
- The frozen tier streams (`scripts/engine/tiers.ts`, unchanged) generate ideas through
  `executeRun`, exactly as the live engine does.
- Each idea goes through the learner's own pure decision step (`stepTick`, provenance
  `replay`, take-every-idea v1) and its own execution simulator: next bar after the
  decision, costs on both sides, the gap through a stop at the open, the stop first on
  a bar that touches both, flat by the session close, no exit invented on stale prices,
  a $100 risk limit with integer quantity.
- **Observation replay (primary):** decided at the first learner check (:07, :22, :37,
  :52) after signal time + max(5 min, the measured median live delay). The delay is
  measured at registration from live ideas (1,525 s median at drafting, n = 133) and
  frozen in the manifest. Modelled, not recorded.
- **Strategy replay (secondary):** decided at the close of the entry bar. Reported, never
  trained on.
- Data quality per chunk: OHLC consistency, duplicates, ordering, gaps (≥ 2 missing
  expected bars, excluding the daily break, weekends, holidays and early closes) and
  discontinuities (a jump larger than max(6 × ATR14, 8 MES / 40 MNQ points)). Gaps are
  never filled and jumps never spliced: an idea whose decision-to-exit window touches a
  flagged window (with a 1-hour lead) is quarantined.

## Dataset (stage 3)

One row per opportunity family (`tier:strategy:symbol:signalTs`), primary mode only.
Exclusions, each counted: other mode, duplicate family, structurally void (idea already
over, session over, stale prices, stop already breached, target passed), over-risk
(quantity 0 under the $100 limit — a diagnostic, never a training row), quarantined,
label not ready by the scope cut-off (2026-09-23 23:59:59 UTC), missing features. The
rows hash is stored. Legacy signal and shadow rows in scope are matched to families and
reported (count, matched); they are never labels.

## Splits and folds

- Chronological by eligible session, fixed once before any outcome is read: earliest 60%
  development, next 20% validation, latest 20% final.
- Five expanding walk-forward folds inside development. Training rows must exit before
  the test period starts minus a 5-trading-day embargo. Scaling, the probability
  threshold (EV break-even τ) and the model are fitted on each fold's training rows only.
- **Fold coverage (preregistered):** every fold needs ≥ 50 training rows after the window
  and embargo and ≥ 10 test rows, or the trial **fails coverage** — it is never scored on
  the folds that survived. The fold report (training, purged and test rows, sessions)
  is stored for every trial.

## Trials (stage 4)

Three specifications from the live experiment's 18-spec grid, drawn once with seed
20261008 and written to the manifest before replay:

| Trial | Window | Features | L2 |
|---|---|---|---|
| 1 | last 120 sessions | v1 | 0.001 |
| 2 | last 60 sessions | v1 | 0.001 |
| 3 | last 120 sessions | v1 | 0.01 |

A restart resumes these trials; it never creates another search.

Each trial is compared on the same ideas with: the incumbent (take every idea), a
training base-rate predictor, the $0 no-trade baseline and matched seeded random picks
(same count per session). Reported per period: net per idea and gain over the incumbent
with session-bootstrap intervals (Bonferroni across the 3 trials), the random-pick
percentile, p95 session-reshuffled drawdown, doubled costs, costs paid, selected count,
Brier score and log loss against the incumbent and the base rate, reliability bins (when
n ≥ 50), and an end-to-end virtual account under the experiment's risk limits ($10,000,
$100 a trade, $200 open, $400 a day, $2,000 drawdown lock).

**Selection:** the highest validation lower bound of the gain over the incumbent among
trials that pass coverage. **Final:** the selected specification is fitted once on
development + validation (≤ 25,000 rows), frozen, and scored once on the final period.
The access time is stored; the final period is never opened again. Verdict by the
campaign's existing floors (`verdictOf`: 150 outcomes, both lower bounds > 0, ≥ 95th
percentile vs random, p95 drawdown < $2,000, positive with doubled costs, better Brier).

## Fresh shadow (stage 5)

Shadow-eligible only when coverage passed and the final verdict is pass or inconclusive.
The frozen artifact is copied into the live experiment as a new **shadowing** version
with its study id, dataset hash, artifact hash, training cut-off, verdict,
development-exposed flag and manifest hash, at the real registration time. It scores
each new idea beside the incumbent and never changes a decision, the ledger, the
balance or the pointer. No refill, no reset, no new campaign. Idempotent by artifact
hash.

Adoption needs every live gate, unchanged: 150 out-of-sample outcomes, ≥ 20 fresh
sessions and ≥ 60 fresh decisions after registration, two passing reviews ≥ 6 days
apart with ≥ 10 new outcomes each. Historical replay counts for none of them. Lifecycle
for an imported candidate: 52 weeks of shadowing or 52 inconclusive reviews
(`IMPORTED_LIFECYCLES`), because the campaign's 6-week limit is shorter than the fresh
window takes at the measured idea rate. Evidence floors stay the campaign's.

## Budget (stage 6)

One worker (lease), one chunk at a time, checkpointed after each chunk. Replay jobs are
capped at 5 minutes each and 30 active minutes in total for the initial batch; reaching
the cap records a partial result and waits. ≤ 25,000 examples per fit. Quota: at 70% of
the free database allowance optional work is reduced, at 85% replay and searches stop,
at 95% only essential reconciliation runs. Unknown or stale (> 1 hour) usage telemetry
pauses the study. Manual GitHub workflow on a free standard runner
(`.github/workflows/historical-study.yml`).

## Run order

1. `register` — freeze rules, manifest and trials.
2. `replay` with `max_chunks=2` (the newest MES month, then MNQ) — measure runtime,
   memory, bars and bytes before expanding.
3. `replay` until complete (5-minute jobs, 30 active minutes in total).
4. `study` — dataset, split, trials, selection, the one final look.
5. `shadow` — only when eligible.

## Migration and rollback

`db/migrations/20261007_historical_study.sql` adds the private `history_*` tables, their
write-once/append-only triggers and the public `history_overview` totals view; it reads
`experiment_*`, `signals` and `shadow_signals` and writes none of them. Rollback:
`DROP VIEW history_overview; DROP TABLE history_finals, history_trials, history_examples,
history_chunks, history_leases, history_runs, history_studies;` plus the guard functions.
An imported shadow version, if one exists, stays in the experiment's append-only history
(retire it through the normal lifecycle; never delete it).

## Results (run 2026-10-07, appended after the one final look)

Study `hist-2026-10-07`, manifest hash `0b96fd8a…6752`, rules hash `43f5447e…3f13`,
registered at commit 46c583d; replay finished at 58299ba (throughput and budget-accounting
fixes only — no rule, decision or execution change). Frozen observation delay: 1,525 s
median (p25 1,098 s, p75 2,384 s, n = 133 live ideas).

**Replay.** 178 of 178 market-months, 0 failed. 5,931 opportunity families (both modes:
11,862 rows). Observation mode: 1,959 taken, 3,537 already over when seen, 273 too
risky for one contract, 89 after the session, 73 stop under 2 points. 1,236 observation rows touched a flagged data fault (4,418 gap
flags and 332 jump flags, counted per overlapping read window); most were already void,
and 10 otherwise-eligible rows were excluded for it. Take-every-idea on this data, one
contract, after costs: −$23,832 with the delay, −$23,246 at the setup time.

**Dataset.** 1,897 eligible rows over 1,161 sessions (1,760 rsi-reversion, 137
zone-v5; 976 MES, 921 MNQ). Split: development 2019-05-07 → 2023-08-11 (696 sessions,
1,128 rows), validation 2023-08-14 → 2025-02-12 (232, 382), final 2025-02-14 →
2026-09-21 (233, 387). Legacy audit: 121 of 138 live ideas in scope match replay
families (the rest were priced on the Yahoo feed); 0 of 481 shadow rows match, as
expected — they belong to other research methods (vwap-reversion, bollinger-breakout,
ema-cross, orb), not the tier streams.

**Trials.** All three passed fold coverage (5 of 5 folds; smallest fold trained on 176,
90 and 176 rows). Development gain over the incumbent was positive for all three (lower
bounds $1.87, $2.94, $2.14 per idea, n = 933); on validation every lower bound was
negative (−$7.92, −$10.74, −$7.89, n = 382). Selected: trial 3 (window 120 sessions,
v1, L2 0.01), highest validation lower bound.

**Final period (opened once, development-exposed).** Fitted on 195 rows up to
2025-02-06, scored on 387 ideas over 233 sessions. Gain over take-every-idea +$7.35 per
idea (likely $2.15 to $13.10); net per idea −$8.76 (likely −$16.39 to −$0.82); 48.8th
percentile against matched random picks; p95 drawdown $4,617; −$5,670 with costs
doubled; Brier 0.2505 vs 0.2512 (base rate 0.2512), log loss 0.694 vs 0.696. Same-limits
virtual account: −$2,088 on 73 trades vs −$1,990 on 78 for take-every-idea. Verdict:
**fail** (beats no-trade, beats random, drawdown and doubled costs all failed). The
filter loses less than taking everything only because it skips some losers; what it
keeps still loses and is no better than random picks of the same size.

**Shadow.** Not eligible (verdict fail); nothing was registered in the live experiment.
The virtual account, its pointer and its history are unchanged.

**Conclusion: No validated improvement yet.** Per the rules, this study version is
closed: its final period has been used and cannot be used again for another search.
A new study would need a new version registered first.

**Measured budget.** Replay: 4 runs, 588.9 s of recorded wall time in total (27.5 s,
304.4 s, 3.5 s for a run that failed on a placeholder bug and rolled back, 253.5 s) of
the 30-minute cap; peak memory 295 MB; 200 MB of bars read across overlapping windows.
Study 7.9 s, shadow 0.4 s. Database 315 MB after the study (history_examples 9 MB).
$0: free GitHub runner, Neon Free, no downloads, no paid services.
