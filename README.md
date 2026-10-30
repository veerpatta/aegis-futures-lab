# Aegis Futures Lab

Aegis is a virtual-only futures research lab for MES and MNQ. It records ideas, simulates a single $10,000 learner account on delayed prices and tests methods against explicit controls. There is no broker connection and no real-money execution. Trade ideas are research records, not instructions.

## Current research standing

The three source streams have not demonstrated an edge. The corrected seven-year study found that none of 17 symbol-year comparisons cleared the matched-random benchmark, and all three streams lost money after modelled costs. Earlier claims that tier A was anti-predictive and MNQ was break-even before costs were withdrawn after correcting execution assumptions. See [the corrected findings](docs/research/2026-08-17-remeasurement.md).

The loss guards may pause a source after a poor recent run. Paused ideas continue as separate source simulations; they are withheld from the learner. If the source cannot verify a pause, the engine fails the check before it writes signal rows or publishes a learner batch. The bot may legitimately be quiet while methods are paused or evidence is insufficient.

The learner's frozen control takes eligible ideas subject to its risk limits. It has not automatically found a profitable method. Replay, late and synthetic observations are labelled separately from fresh evidence; a model takes over only after the registered evaluation and forward checks pass. See [the learner's registered rules](docs/research/2026-10-07-experiment-preregistration.md).

## Using the app

- **Today** shows the current account, activity and market context.
- **Trades** shows the learner's decisions, simulated fills, skips, results and evidence.
- **Learn** shows learning progress, paused-method practice, the historical study and method research. Weekly method screens compare registered research with matched random entries and show historical net against the $0 no-trade baseline. A screen is not a promotion.
- **Chart** shows delayed prices and virtual trades.
- **More** holds Ideas, the Journal, Guide, Lab, Diagnostics and Data.

The in-app Guide and [user manual](docs/USER-MANUAL.md) explain the workflow and its limits. Market data is delayed; a successful scheduled check is not evidence of profitability.

## Engine and development

The scheduled GitHub Actions engine (`.github/workflows/signal-engine.yml`) fetches delayed data, simulates the configured streams, checks their pause rules, records source results and publishes an eligible batch for the separate virtual learner. The scheduled weekly benchmark measures one unmeasured method at a time under a registered rule; it never promotes a method automatically.

**Do not run `scripts/engine/run-live.ts` or `npm run engine` locally.** The engine has no dry-run mode and the local environment can point to the production database. Research measurements run in CI, not locally. Read [AGENTS.md](AGENTS.md) for the research-code hash, data, documentation and testing constraints.

```bash
npm install
npm run dev       # http://localhost:3000
npm test          # unit and integration tests
npm run build     # production build
npm run test:e2e  # browser tests; build first
```

The app uses Next.js, React, TypeScript, Neon and GitHub Actions. Research and paper-account evidence remain separate from the owner's private journal. The market feed is unofficial and may be delayed, rate-limited or unavailable; the app must show missing or stale data rather than inventing prices.
