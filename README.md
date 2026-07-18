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
(`/api/events`). No database, no auth, no tracking; presets and the forward test
persist in `localStorage`.

## Data disclaimers

- Market data is **delayed** and comes from an unofficial free source that can
  rate-limit or fail; the UI surfaces feed errors verbatim and never invents values.
- The economic calendar covers scheduled 2026 BLS/Fed releases only; unscheduled
  events would require a licensed real-time calendar.
