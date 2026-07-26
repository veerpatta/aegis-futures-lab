# Research log

Dated entries from the nightly research analyst, appended in run order.

## 2026-07-26

First entry — this file did not exist before this run.
- engine_runs (n=4, 26h): 1 error at 07:43 UTC (signals_status_check), then 3 ok runs 07:47–07:55 — self-resolved, not recurring, no issue opened.
- Those Sat runs correctly flagged bars stale (650–660m old, limit 30m) and excluded them from stats — the bar-age gate working, not a fault.
- No signals or shadow_signals closed in the trailing 24h (n=0) — market closed, expected.
- Rolling PF, last ≤20 closed real signals: tier B MNQ pf=1.71 (n=12), tier B MES pf=10.89 (n=8) — both well above the 0.8 breaker floor. Tier A n=0 (fires rarely). bot_policy has zero flip rows ever.
- fill_reality: last 2 weeks both 0% doubtful (W29 n=11, W30 n=9) — no drift toward optimism yet.
- shadow_scoreboard: 7 audition streams, largest n=14, none near the 60-closed promotion bar; ema-cross MES/MNQ deep negative early (pf 0 / 0.12, n=14 each) but too small to call broken.
- model_registry: train_n 93→93→95→96 across 4 retrains since 07-24; oos_brier beat baseline both times it carried a value (0.2425, 0.1753 vs ~0.315 baseline), status still "observe".
- score_calibration empty — structural (tier A silent), not a bug.
- No learned_stats key missing for the newest NY trading day (2026-07-24, Fri) — nightly-learn ran clean.

## 2026-07-26 (weekly research desk)

Three hypotheses tested, all refuted for the two live tier streams. Full
writeup: `docs/research/2026-07-26-hypotheses.md`.
- H1 (management replay): 8 alternative exit rules replayed over each tier
  stream's own trades (entries fixed) on the full day-aligned archive.
  Whichever variant won on a train slice lost to the live baseline on the
  held-out validation slice for both B:MES and B:MNQ — the overfitting
  signature the brief warned about. Tier A's validation slice ate 14 of 16
  trades (single-day clustering, already known) so no variant beat baseline
  there either. No management change proposed.
- H2 (time-of-day/day-of-week): pooled 530 trades across tier A/B and 3
  active shadow strategies × 2 symbols on the same archive. Worst train-slice
  hour (04:00 ET, n=31, -$49/trade) nearly vanished on validation (n=19,
  -$0.75); worst train-slice weekday (Tue, n=84, -$33) flipped positive on
  validation (n=30, +$15). Both live tier-B streams have n<15 in every hour
  bucket — insufficient to test an hour restriction on them at all this
  week. One shadow-only pattern (vwap-reversion MNQ, 01:00 ET, n=21/-$26
  train, n=15/-$62 validation) survived with adequate n on both sides but
  concerns an audition strategy, not a live one.
- H3 (cost sensitivity): live config re-run at 2x/3x slippage. B:MES and
  B:MNQ hold PF>1 through 3x and across all 11 one-day window shifts
  (B:MES 1.24–1.47 @ 2x, B:MNQ 1.17–1.44 @ 2x) — not a cost artifact. Tier A's
  full-archive point estimate holds (PF 1.03 @ 2x) but the same window-shift
  check that confirmed B's result shows tier A ranging 0.85–1.03 @ 2x across
  shifts — six of eleven land below breakeven. Same single-day-clustering
  fragility as `PHASE1-FINDINGS.md`, showing up again in this measurement;
  called borderline/inconclusive rather than forced to a verdict.
- No code change proposed this week. GitHub issue opened (label `research`)
  with the full SURVIVED/REFUTED table.
