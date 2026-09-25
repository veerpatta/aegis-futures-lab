# Training recovery and fixed replacement hypotheses

Paper only. Delayed data. Nothing here touches real money.

## Recovery

The Neon JSON transport now preserves model coefficient and calibration arrays as
JSON instead of PostgreSQL arrays. A failed model write fails the learning run.
The production recovery cutoff was 2026-09-25 02:00 UTC. Between September 15 and
that cutoff, MES and MNQ each had all 1,288 expected bars in the 02:00–15:25 ET
entry window, adjusted for the market calendar. This does not certify every
overnight bar. Seven new-strategy outcomes were reconstructed in the separate
historical replay ledger; none counts as forward evidence.

The recovered original model trained on 587 eligible closed trades. Its
out-of-sample Brier score was 0.2336 versus 0.2259 for the training base-rate
predictor (lower is better). It remains demoted and undeployed. v2 adds market,
strategy, overnight-session, volatility and VWAP-distance features and must
improve both probability accuracy and net trading results. It remains an
observation-only challenger.

## Frozen development results

Each strategy–market pair was registered before reading the archive. There was
one fixed rule set per family, no search or adjustment after seeing results.
The already-inspected Databento archive through July 29 is development data.
The period beginning July 30 is reserved for separate contract confirmation.

| Strategy | Market | Closed trades | Net after costs | Drawdown with doubled commission and slippage |
|---|---|---:|---:|---:|
| First-retest zone rejection | MES | 3 | $92.80 | $0.00 |
| First-retest zone rejection | MNQ | 1 | $49.60 | $0.00 |
| RSI with market context | MES | 548 | -$6,535.99 | $8,501.60 |
| RSI with market context | MNQ | 405 | -$1,364.39 | $2,236.71 |
| Trend pullback to VWAP | MES | 1,211 | -$12,174.32 | $15,683.30 |
| Trend pullback to VWAP | MNQ | 602 | -$3,559.90 | $5,298.20 |

**Zero of six passed.** Three and one trades are insufficient evidence, not
proof of profit. The other four lose money and breach the stressed drawdown
budget. Random-entry simulations were deliberately not run for candidates
already blocked by negative returns or insufficient samples; those checks are
reported as unmeasured, never passed. The original controls remain unchanged.
The complete measured gate details are in `2026-09-25-research-v2.json`.

The first calculation counted 13 registry rows. An audit found that older rows
bundled multiple markets and that the published gold test was absent. The
corrected count is 22 known trials. Gold is explicitly recorded as retrospective
inventory, not preregistration. Corrected evaluations were appended; the original
write-once records remain intact. All six verdicts remain blocked.

## Paper account

The separate account starts at $10,000, with $25 probation risk, $50 full risk,
$100 aggregate open risk, $200 daily loss including open positions and a $1,000
persistent peak-to-trough lock. Sizing includes execution costs and skips a
contract too large for the remaining budget. Losses survive release changes.
Only registered, deployed strategy code with matching code/config hashes is
eligible. Activation also needs separate confirmation, every historical gate,
60 genuinely forward closes across 20 days, and two weekly passes at least six
days apart with ten new closes. One candidate runs at a time. A failed release
pauses; there is no fallback to an unqualified control.

Forward evidence is created only when a decision is observed before its next
bar arrives. Discovering a trade already open would bias the sample toward
survivors, so those observations remain historical. Missed scheduler decisions
are not reconstructed into forward evidence.

## Reproduction and operations

Use a server-side `DATABASE_URL` environment variable. Never put it in client code.

```powershell
npx tsx scripts/engine/recover-training.ts --from 2026-09-15T00:00:00Z --as-of 2026-09-25T02:00:00Z
$env:LEARNING_AS_OF = '2026-09-25T02:00:00Z'
npx tsx scripts/engine/learn.ts
# Normal daily/weekly jobs omit LEARNING_AS_OF. Recovery cannot activate models.
npx tsx scripts/diag/research-v2.ts --register-only
npx tsx scripts/diag/research-v2.ts
npx tsx scripts/engine/paper-release.ts
```

Re-running recovery with the same window/configuration is a no-op. Original run
failures are retained. Historical results and observations cannot be rewritten.
The database migration was tested twice on an isolated branch before production;
all 232 original columns were verified against the canonical schema.

`registered-research-v2` supports recovery, development, confirmation and a
metadata-only Databento estimate. Downloads require a verified credit balance
less than one hour old, availability checks, a 25% cost reserve and available
storage. Unknown credit means no download. No provider upgrade is authorized.
Forward collection is part of the signal engine; weekly release evaluation is
part of `weekly-challenger`. Future elapsed trading days cannot be manufactured
by backfilling or repeatedly running a job.

Later on September 25, the owner supplied a $102.76 credit screenshot and approved
the bounded trader-workspace research plan. Its separate `trader-research`
workflow uses that attested cap with reservations and private download caching.
See `2026-09-25-trader-workspace.md` for the completed import, audit and research
results, including the contract-expiry data gap that blocks qualification.
