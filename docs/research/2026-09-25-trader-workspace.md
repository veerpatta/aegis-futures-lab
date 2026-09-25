# Trader workspace and bounded research — 25 September 2026

Paper only. Delayed data. Nothing here touches real money.

## Delivered

Today, Bot, Markets, Journal and More are the five phone tabs. Today reads the
actual practice account, releases and positions. Bot separates price checks,
training, strategy tests, confirmation and genuinely new observations. Detail
sheets explain risk, entry decisions and qualification. Legacy simulated signal
returns and personal journal trades stay separate from the practice account.

Failed reads retain the previous snapshot and show an update warning. An unknown
position list is never presented as an empty account. Money hiding and ET/IST
work with the new screens. The Guide, markdown manual and generated PDF match.

## Credit-funded data

The owner authorized the $102.76 credit shown in their September 25 screenshot,
expiring February 1, 2027. This is a user-attested budget, not a live billing
balance. No subscription, upgrade or new payment was made.

- 80 daily MES/MNQ one-minute requests, July 30 through September 23 inclusive.
- 21,404 five-minute bars imported, 10,702 for each market.
- 14 finer-data requests for seven selected exits.
- 94 total requests quoted at **$0.699263438616**.
- **$0.87407929827** reserved, including the 25% margin.
- About **$102.06** of the attested credit remains before any other account use.
- Private compressed downloads are cached in Neon. Repeat requests reuse them.
  Raw licensed data is not in Git or public artifacts. Public/anonymous roles
  cannot access the private purchase schema.

The importer completed in GitHub run `36100790098`. An earlier attempt failed
on a metadata HTTP method before buying data; the corrected run succeeded.

## Data audit and remaining limitation

The audit found no malformed prices, duplicate minutes, misaligned bars or
differences between cached downloads and stored aggregates. It also found
**72 missing expected session bars per market on September 18**, beginning at
09:25 ET. Thirty overnight windows per market are complete; incomplete windows
are rejected by the new overnight strategy.

The downloaded calendar-front contract changes on September 21. The raw change
is 93.25 points for MES and 498.25 points for MNQ. These are unadjusted contract
series; those jumps must not be interpreted as a tradable continuous price move.

The September 18 gap is consistent with quarterly expiry: Databento's
[calendar symbology](https://databento.com/docs/standards-and-conventions/symbology)
selects the closest expiry, while CME's
[contract specifications](https://www.cmegroup.com/trading/equity-index/files/cme-micro-e-mini-futures-fact-card.pdf)
end expiring micro futures at 08:30 CT on the third Friday. The adapter also
discards a trailing five-minute bucket without a later minute to prove closure.
This explanation is an inference from the raw timing and contract rules.

No replacement contract was silently spliced into the frozen research series.
No missing prices were invented. Confirmation runs are recorded as provisional;
the explicit contract-data check prevents them from qualifying any strategy.
A future contract-aware dataset revision must carry its own provenance and be
remeasured before it can remove that block. The known UTC-Sunday continuous-data
gap remains documented as well.

Evidence: `2026-09-25-contract-quality.json`.

## Frozen research results

Exactly two new hypotheses were tested on two markets. Rules were registered
before testing; they were not tuned after the results. There are 26 known trials
in the multiple-testing count, and zero of ten current development results pass.

| New strategy | Market | Development trades | Net after costs |
|---|---|---:|---:|
| Opening continuation | MES | 657 | -$3,086.85 |
| Opening continuation | MNQ | 239 | -$2,259.70 |
| Failed overnight breakout | MES | 803 | -$8,204.20 |
| Failed overnight breakout | MNQ | 548 | -$10,120.60 |

All four failed before a random-entry comparison was needed. An unrun check is
not described as a pass or as evidence of anti-predictiveness. The earlier failed
controls remain unchanged.

The separate July 30–September 23 confirmation simulations have zero qualifying
results. New-candidate counts are 9, 0, 12 and 3 respectively, far below the
minimum. Their results are also blocked by the incomplete contract session.
Past replay never counts toward the required forward closes or trading days.

Evidence: `2026-09-25-research-v2.json` and
`2026-09-25-research-v2-confirmation.json`. Research code hash:
`affc097472cb222c45171bf44bd791bf2dc600fca33c2b40c64fd0d080bd6de6`.
Initial trial outcomes and later measurements remain immutable in Neon.

## Execution audit

Seven exits were selected deterministically from ambiguous or gapped bars after
the import. One-second prices show six stop-first exits and one target-first
exit. Mean quoted spreads range from 0.253–0.262 points for the two MES samples
and 0.383–0.714 for the five MNQ samples. These selected cases are not a
representative spread estimate, and trade-time quotes do not prove a fill.
No production cost or fill assumption was relaxed.

Evidence: `2026-09-25-execution-audit.json`; GitHub run `36101076905`.

## Recovery and training

The July 30–September 23 recovery recorded 54 historical observations with
explicit replay provenance and the 72-bar-per-market coverage gap. It did not
fabricate successful past training runs or new forward observations.

Training at the recovery cutoff completed, followed by a current daily run:
588 eligible closed trades, prediction error 0.2344 versus 0.2268 for the simple
baseline (lower is better). The model remains inactive/demoted. All ten release
evaluations are ineligible. No strategy or model was activated.

The UI accurately shows **Researching**, **training up to date**, and the
evidence required before practice trading can begin.

## Verification

- All 232 original database columns checked against the canonical schema.
- Migration tested twice on an isolated branch and then applied to production.
- Anonymous read models work; the private download ledger remains inaccessible.
- 949 unit tests pass, including parity and incomplete-confirmation guards.
- TypeScript and production build checks pass.
- Browser checks cover 360, 390, 430 and 1440 pixels, six account states, sheets,
  navigation, read errors and money masking. These are browser checks, not a
  claim of physical-phone certification.

The temporary `codex-trader-ui` Neon branch is retained for repeatable migration
validation. Production runs on the main branch.
