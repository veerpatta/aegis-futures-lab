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
