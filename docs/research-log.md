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
