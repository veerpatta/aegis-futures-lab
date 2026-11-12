# Time machine filter — historical result (2026-11-12)

The one preregistered look of `tm-filter-v1` on past ideas
(`docs/research/2026-11-12-time-machine-filter-preregistration.md`, rules hash
`7be49bdb…fbdb7e`). Stored once in `tm_filter_looks` (study `tm-filter-v1-historical`, look 1,
taken 2026-11-12 03:38 UTC) and never recomputed. Development-exposed: earlier research inspected
these years; this rule has nothing to tune and was not fitted on them.

## Verdict: inconclusive. This version's path to trades is closed.

All 1,897 eligible rows of the registered historical study `hist-2026-10-07` were regenerated
from the Databento archive with the study's own code, and every regenerated outcome matched the
stored one (the run stops on any mismatch). Rows hash `158588b3…2063`.

| Measure | Result | Pass needs |
|---|---|---|
| Per-idea delta (kept minus take-all, skipped = 0) | +$2.29 (95% interval +$0.38 to +$4.19) | interval above 0 ✓ |
| Matched random skips | **0.7th percentile** | ≥ 95 ✗ |
| Kept ideas after costs | −$4,512.20 (take every idea: −$8,849.87) | > 0 ✗ |
| Skip rate | 62.7% (1,190 of 1,897) | 10% to 60% ✗ |

1,161 sessions. The time machine could not run on 575 ideas (572 too few full past days, 3
early-close days), which the rule takes. Most of them are in 2019 and 2020: the pool rule leaves
out every archive day that touches a flagged data fault (845 MES and 838 MNQ days), so the early
archive rarely has 20 full days.

## What it means

The filter only looks better than taking every idea because it skips most of a losing stream.
Random skips of the same size do better 99.3% of the time. The ideas it approved were the worst
group, not the best:

| Group | Ideas | Total after costs | Per idea | Wins |
|---|---|---|---|---|
| Approved by the time machine (taken) | 132 | −$1,675.84 | −$12.70 | 37.1% |
| Time machine could not run (taken) | 575 | −$2,836.36 | −$4.93 | 47.3% |
| Skipped | 1,190 | −$4,337.67 | −$3.65 | 46.8% |

On average the replays sit near zero before costs (−0.03 times the risk on skipped ideas) and
costs are about 0.14 times the risk, so the rule mostly says "costs eat it". That matches the
standing finding that these methods do not beat random entries
(`docs/research/2026-08-17-remeasurement.md`), and it repeats the historical study's own
lesson: a filter that loses less than take-every-idea by skipping losers has found nothing.

## What happens now

- Per the preregistration, `tm-filter-v1` is **not** eligible to shadow in the learner. Nothing
  changes trades, the account, a method's standing or the promotion gate.
- The forward test keeps scoring new learner decisions for information (registered
  2026-11-12 04:06 UTC). Its looks at 60 and 150 still decide only eligibility for a future
  campaign.
- **Do not invert or tune this rule on these rows.** "Skip what it approves" was chosen after
  seeing this table, so it would be a new hypothesis. It would need a new version, a new
  preregistration, and data no one has seen.
