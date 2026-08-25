# Phase 4 replacement findings — 25 August 2026

## Decision

**Refute both candidate families. Promote nothing.** Zero of 12 candidate/symbol runs
cleared the preregistered promotion gate, so Aegis remains in research mode with no active
replacement for the paused streams.

## What was measured

Six configurations were registered before the run and evaluated on the seven-year Databento
archive for both MES and MNQ. Every eligible cell used 500 deterministic matched-random draws
through the same next-open, cost-aware execution engine as the real strategy.

| Candidate | Configuration | MES net / percentile | MNQ net / percentile | Decision |
|---|---:|---:|---:|---|
| ORB + relative volume | 1.2× | −$1,226 / 90.8 | −$1,134 / 34.6 | Refuted |
| ORB + relative volume | 1.5× | −$312 / 70.8 | −$87 / not measured (22 trades) | Refuted |
| ORB + relative volume | 2.0× | +$21 / not measured (20 trades) | −$51 / not measured (7 trades) | Refuted |
| Turn of month | last 1, first 1 | −$2,702 / 71.2 | −$2,375 / 27.6 | Refuted |
| Turn of month | last 1, first 3 | −$2,892 / 96.8 | +$510 / 89.6 | Refuted |
| Turn of month | last 4, first 4 | −$15,439 / 66.4 | −$11,152 / 7.4 | Refuted |

The strongest-looking cell, turn-of-month 1/3 on MNQ, still failed random-entry percentile,
deflated Sharpe, t-statistic, probability of backtest overfitting, and purged-fold survival.
The global PBO was 70%, above the preregistered maximum of 50%.

## Arena finding

MES accumulated +73.8% overnight and +72.9% intraday across the archive. MNQ accumulated
+147.1% overnight and +66.6% intraday. The overnight concentration is a structural headwind
for the MNQ turn-of-month hypothesis because this engine is flat by the close.

## Audit trail

- GitHub Actions run: `32813901067`
- Evidence artifact: `9551595553`
- Artifact SHA-256: `75777ceb58580589e748d4a452bebe7ad6d326e64125aac41c8447f4f21d1981`
- Full machine-readable report: `docs/research/phase4-hypotheses.json`
- The six outcomes were written once to `research_trials` at
  `2026-08-25T06:20:13.171Z`; their hypotheses, predictions, decision rules and outcomes are
  guarded against later editing.
