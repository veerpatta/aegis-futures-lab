# Aegis Futures Lab — User Manual

*For traders, not technicians. Everything you need to use the app, in plain language.*

Live app: https://aegis-futures-lab-khaki.vercel.app
This manual is also available inside the app on the **Guide** page.

---

## 1. What this app is

Aegis watches the two micro futures markets — **MES** (Micro E-mini S&P 500) and **MNQ**
(Micro E-mini Nasdaq-100) — and posts **practice trade ideas** two to three times a day
using a demand-and-supply zone strategy. Every idea is tracked to its result (target hit,
stop hit, or closed flat), so you can judge the strategy on evidence instead of memory.

> **Nothing here touches real money.** There is no broker connection, prices are delayed
> 10–15 minutes, and trade ideas appear 5–15 minutes after the setup happens. Use the app
> to practice, learn, and keep score — never as a live trade instruction.

## 2. Your daily routine

1. **Open Signals with your morning coffee.** The strip at the top answers three
   questions at a glance: is the market open, when does the engine check next, and how
   many ideas has it posted today (the three dots fill toward the 2–3 per day target).
2. **Read today's ideas in the blotter.** Each row is a complete trade plan: where to get
   in (Entry), where the idea is wrong (Stop), where to take profit (Target), and how it
   ended (the Status badge).
3. **Glance at the Zone watchlist.** These are the buy and sell areas the strategy cares
   about, sorted by how close price is. An amber **AT ZONE** badge means price is sitting
   in one right now — the interesting moments happen there.
4. **After you trade, write it down.** On the Replay page, add your own trades by hand or
   import the CSV file your broker (Topstep / Tradovate) exports. The journal saves to
   the cloud automatically.
5. **On the weekend, keep score.** The Performance panel shows the win rate and running
   profit of each tier. Give the engine a few weeks of evidence before drawing
   conclusions — a handful of trades proves nothing, in either direction.

## 3. Tier A and Tier B — the two kinds of ideas

- **TIER A** — the classic zone setup: price returning to a fresh Daily or 4-hour
  demand/supply zone with everything lined up. These are **rare** (sometimes none for
  days) but they are the highest-conviction trades the strategy knows.
- **TIER B** — the daily bread-and-butter: a mean-reversion setup that fades short-term
  exhaustion, capped at two trades per market per day and shut off after two losses.
  These keep the feed active every day.

The point of the labels: over time, watch **which tier actually makes money** in the
Performance panel, and weight your attention accordingly.

## 4. How to read one signal

| Field | Meaning |
|---|---|
| Entry / Stop / Target | The full plan. Risk = entry to stop; reward = entry to target. |
| R:R | Reward-to-risk. 1.5 means the target pays 1.5× what the stop costs — you only need to win about 4 in 10 to come out ahead. |
| Status | **TARGET** = winner · **STOP** = loser · **OPEN** = still running · **FLAT CLOSE** = closed at 15:25 ET (the strategy never holds overnight). |
| P&L | Simulated dollars for the position size the engine chose (risking about $160 per trade), commissions already subtracted. |

## 5. What each page does

| Page | What it's for |
|---|---|
| **Signals** | The daily feed. If you only use one page, use this one. |
| **Replay** | Pick any past day: see what the engine did, minute by minute, next to your own journaled trades. This is where the learning happens. |
| **Markets** | Delayed charts, a live strategy readout, and the news calendar. |
| **Lab / Compare / Data** | The workshop (advanced, optional). Change strategy settings, run backtests, compare variants. You never need these to follow the signals. |
| **Guide** | The in-app version of this manual. |

## 6. Put it on your phone

Open the site on your phone, then choose **Add to Home Screen** in the browser menu. It
installs like an app and opens straight onto the signal feed.

## 7. Words you'll see

| Word | Meaning |
|---|---|
| Zone | A price area where big buying (demand) or selling (supply) showed up before. The strategy trades the return to these areas. |
| Fresh / Tested | Fresh = price hasn't come back to the zone yet (strongest). Tested = touched once already. |
| Paper trading | Practice trades with imaginary money. All trades in this app are paper trades. |
| Flat by 15:25 ET | The strategy closes everything before the New York session ends. No overnight risk, ever. |
| Engine | The automated checker that re-reads the market every 15 minutes during London and New York hours. If Signals says the engine is stale or failed, the feed is paused — not the market. |
| Win rate | Share of closed trades that made money. |
| Delayed data | Prices arrive 10–15 minutes late. Fine for studying, useless for live execution. |

## 8. If something looks wrong

- **"Engine idle / stale" badge** — the scheduled checker missed its slot (it runs on a
  free scheduler that is sometimes 5–15 minutes late). It catches up on the next pass;
  nothing is lost, because every pass recomputes the full picture.
- **No signals today** — quiet days happen, especially for Tier A. The pace dots simply
  stay empty. That is information too.
- **"Signal feed unreachable"** — your device is offline or the database is briefly
  unavailable. The page retries every minute on its own.

---

*Manual version: matches the app as of 2026-07-19. If the app has changed since, the
Guide page in the app is the up-to-date reference (this file is regenerated from it —
see CLAUDE.md in the repository).*
