# Aegis Futures Lab

A browser-based strategy research lab for **MES** (Micro E-mini S&P 500) and **MNQ**
(Micro E-mini Nasdaq-100) futures. Pick a strategy, tune its parameters, run a
backtest on delayed data, and see how it would have performed — then compare
variants side by side or paper-trade the winner forward.

**Free Research Edition** — execution is permanently locked. There is no broker
connection anywhere in this codebase; every trade is simulated, and all market
data is delayed and display-only. Results are a research proxy, not a
performance claim.

## Pages

| Page | What it does |
|---|---|
| **Lab** | Strategy gallery → tune parameters → run a backtest (30/40/60-day windows or your own CSV) → KPIs, equity curve, qualification funnel, trades on the chart, exportable ledger. Includes a position-size checker and a **Forward test** tab that paper-trades the selected strategy on the delayed feed. |
| **Compare** | Up to six strategies or parameter variants over the same window: overlaid equity curves and a best-in-row metrics table. Comparisons are URL-shareable. |
| **Markets** | Delayed MES/MNQ quotes, candle chart (5m/15m/1H), a live signal readout for any strategy, and the news-lockout calendar. |
| **Data** | Client-side CSV import (`timestamp,open,high,low,close[,volume]`), replay cutoff slider, and full data provenance. Imported bars never leave the browser. |
| **Signals** | Live paper-signal log written by the scheduled cloud engine: tier A/B signal stream with statuses and P&L, engine heartbeat, and the current demand/supply zone watchlist. |

## Strategy library

- **Zone Engine v5** (flagship) — demand & supply zones (DBR/RBR/RBD/DBD) with strict
  Daily→4H→1H nesting, freshness, the 80% rule, risk-adaptive 1H/15M entries and
  MES/MNQ intermarket confirmation. Ported line-for-line from the original engine
  and locked by golden parity tests. On top of the parity surface, the full
  strategy-spec feature set is parameterized: NY-session zone structure (ignore
  overnight trades), odds-enhancer scoring (fresh / trend / departure / profit
  margin / time-at-base) with 1H swing-structure trend detection, deep 15M
  refinement when the 1H stop exceeds the risk cap, fresh-zone-preferring 1H
  selection, entry triggers (resting limit or confirmation candle), entry-session
  windows, profit targets (2R default, 3R, next opposing zone, or the $160–165
  dollar band) and breakeven + trailing stop management.
- **EMA Crossover**, **RSI Mean-Reversion**, **Opening Range Breakout**,
  **VWAP Reversion**, **Bollinger Squeeze Breakout** — classic parameterized
  strategies implementing the same contract.

Strategies implement one interface (`lib/strategies/types.ts`): heavy precompute in
`prepare()`, then a pure per-timestamp `onSnapshot()` — so nothing can look ahead.

## One backtest engine

Every number in the app comes from a single simulator (`lib/backtest/engine.ts`):

- signals act on completed bars; fills at the **next bar's open ± slippage**
- stop-first same-bar resolution, exits at exact stop/target prices
- quantity and dollar targets re-derived from the actual fill price
- session flat by 15:25 New York; optional discipline locks (daily loss,
  max trades/day, loss streak, drawdown); ±30-minute news lockouts
- runs in a Web Worker with a synchronous fallback

The engine's behavior is pinned by tests: a verbatim extract of the legacy study
walker acts as an oracle, and the trade lists must match exactly
(`tests/engine-v5-parity.test.ts`).

## Cloud signal engine (Supabase + GitHub Actions)

A scheduled job (`.github/workflows/signal-engine.yml`, every 15 minutes during
the London+NY window) runs `scripts/engine/run-live.ts`: it fetches the delayed
Yahoo feed, replays the tier streams through the same backtest simulator the app
uses, and mirrors the results into Supabase (`signals`, `zones`, `engine_runs`).
The **Signals** page and the Replay journal read/write those tables with the
publishable key.

Two signal tiers (`scripts/engine/tiers.ts`, tuned via `npm run engine:report`):

- **Tier A — high conviction**: Zone Engine v5 with the app's default parameters.
  Sparse (~0.3/day) and clustered on the days price reaches Daily/4H structure.
- **Tier B — daily flow**: RSI mean-reversion (25/75, London+NY, 1.5×ATR stop,
  1.5R target) per symbol with tight daily discipline locks (max 2 trades, stop
  after 2 losses / −$250). ~2/day combined.

Together they averaged **2.8 signals/day with ≥1 signal on 45 of 49 trading
days** on the tuning window — with all three streams net positive. Paper
research only: GitHub cron can be 5–15 minutes late and the feed is delayed, so
these signals are a log to study, never execution instructions.

Run locally: `npm run engine` (one engine pass) · `npm run engine:report`
(re-measure the tier configuration over the trailing 60 days).

The journal on the Replay page also syncs to the Supabase `trades` table and
imports Tradovate/Topstep performance CSVs directly.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # vitest: parity, engine, indicators, strategy behavior
npm run build   # production build (Vercel auto-detects Next.js)
```

Stack: Next.js (App Router, TypeScript), plain CSS custom properties + CSS Modules,
[lightweight-charts](https://github.com/tradingview/lightweight-charts) for candles.
Serverless API routes proxy the free delayed Yahoo Finance feed
(`/api/market`, `/api/history`) and serve the verified 2026 economic calendar
(`/api/events`). Presets and the forward test persist in `localStorage`; the
signal log and journal mirror live in a free-tier Supabase project (RLS-governed,
publishable key only — no auth, no tracking).

## Data disclaimers

- Market data is **delayed** and comes from an unofficial free source that can
  rate-limit or fail; the UI surfaces feed errors verbatim and never invents values.
- The economic calendar covers scheduled 2026 BLS/Fed releases only; unscheduled
  events would require a licensed real-time calendar.
