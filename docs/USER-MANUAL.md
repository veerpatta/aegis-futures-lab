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

1. **Open Home with your morning coffee.** It is the screen the app starts on and it
   answers the whole morning in one look: how many ideas today (the dots fill toward the
   2–3 per day target), today's profit or loss, when the bot checks next, and — at the
   top — the one idea that is live right now, with its entry, stop and target. If nothing
   is running, it says so plainly.
2. **Scroll on for the last three weeks.** One bar per trading day, green above the line
   and red below, with the net, the win rate and the number of ideas beside it. Below
   that: the two markets, the zones price is closest to, and whether the bot is healthy.
3. **Open Signals when you want the detail.** Every idea ever posted, grouped by day.
   Each row is a complete trade plan: where to get in (Entry), where the idea is wrong
   (Stop), where to take profit (Target), and how it ended (the Status badge).
4. **Glance at the Zone watchlist.** These are the buy and sell areas the strategy cares
   about, sorted by how close price is. An amber **AT ZONE** badge means price is sitting
   in one right now — the interesting moments happen there.
5. **After you trade, write it down.** On the Journal page, add your own trades by hand
   or import the CSV file your broker (Topstep / Tradovate) exports. The journal saves to
   the cloud automatically.
6. **On the weekend, keep score.** The Performance panel shows the win rate and running
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
| Status | **TARGET** = winner · **STOP** = loser · **OPEN** = still running · **FLAT CLOSE** = closed at 15:25 ET / 00:55 IST (the strategy never holds overnight). |
| P&L | Simulated dollars for the position size the engine chose (risking about $160 per trade), commissions already subtracted. |
| Regime | What kind of market the idea was born into: trending or ranging, quiet or volatile (e.g. **TR·HV** = trending, high volatility). It never changes the ideas — it is a label, so the Performance panel can show which conditions the strategy actually earns in. |

## 5. What each page does

| Page | What it's for |
|---|---|
| **Home** | The screen the app opens on. Today at a glance: the live idea, today's score, the last three weeks, the two markets, the nearest zones, and whether the bot is healthy. |
| **Signals** | Every idea, grouped by day, with the full zone watchlist and engine detail. |
| **Markets** | Delayed charts, a live strategy readout, and the news calendar — each week's high-impact U.S. events from a free live feed, backed by the official BLS and Fed schedules when the feed is down. |
| **Journal** | Pick any past day: see what the engine did, minute by minute, next to your own journaled trades. This is where the learning happens. |
| **Strategy Lab** | The workshop (advanced, optional). Change strategy settings and run backtests. |
| **Compare / Data** | More of the workshop — compare variants, load your own CSV history. Both sit under **More** in the side menu on a computer. The Data page also shows the app's own price archive: it saves its five-minute history to the cloud every day, so over time backtests can reach further back than the feed's 60-day limit. |
| **Guide** | The in-app version of this manual. |

You never need the workshop pages to follow the signals.

## 6. ET or IST — your choice

Every time in the app can be shown on the New York exchange clock (**ET**) or on your own
clock in India (**IST**). Use the **ET / IST** switch — bottom of the side menu on a
computer, top right on a phone. The choice is remembered on that device and it changes
every screen at once: signal times, the chart's time axis, the journal, the news calendar.

Two things deliberately do **not** move:

- **Trading days.** The blotter groups ideas by New York trading day, always. An idea
  posted at 21:20 IST belongs to that New York session, not to the next Indian date.
- **Journal entry times.** You type your own trades in ET, because that is what the chart
  and the engine's own timestamps use. When the app is set to IST, the form shows what
  your typed ET time means in IST as you go.

India does not change its clocks but the United States does, so the gap is 9½ hours from
March to November and 10½ hours through the winter. The app works this out for you — the
session rules always print both, like "flat by 15:25 ET (00:55 IST)", and that second
figure shifts by itself when New York changes its clocks.

## 7. Put it on your phone

Open the site on your phone, then choose **Add to Home Screen** in the browser menu. It
installs like an app and opens straight onto the Home screen, with the five main pages
along the bottom.

## 7b. Telegram alerts (optional)

The bot can message you on Telegram the moment an idea triggers — entry, stop, target
and reward-to-risk, with the time in both ET and IST — and again when it closes with
the result. These are **paper ideas, not orders**: the same delayed data and the same
simulation as the app, just delivered to your phone. It also messages if an engine run
fails, so a quiet feed means a healthy bot, not a broken one. (Set up once by the
operator with a free Telegram bot; nothing to configure in the app.)

## 8. Words you'll see

| Word | Meaning |
|---|---|
| Zone | A price area where big buying (demand) or selling (supply) showed up before. The strategy trades the return to these areas. |
| Fresh / Tested | Fresh = price hasn't come back to the zone yet (strongest). Tested = touched once already. |
| Paper trading | Practice trades with imaginary money. All trades in this app are paper trades. |
| Flat by 15:25 ET | The strategy closes everything before the New York session ends (00:55 IST in summer, 01:55 in winter). No overnight risk, ever. |
| Engine (the "bot") | The automated checker that re-reads the market every 15 minutes during London and New York hours. If Home or Signals says the bot is idle or a run failed, the feed is paused — not the market. |
| Win rate | Share of closed trades that made money. |
| Delayed data | Prices arrive 10–15 minutes late. Fine for studying, useless for live execution. |
| ET / IST | The two clocks the app can show. ET is New York exchange time — the clock the strategy is written in. |

## 9. If something looks wrong

- **"Data delayed more than usual"** — an amber note on Home (Bot status) and on the
  Signals heartbeat. The bot is running, but the prices it last saw are older than the
  usual 10–15 minutes (a slow feed or a missed check during market hours). Ideas simply
  catch up on the next pass — treat the current ones as extra-delayed.
- **"Bot idle" on Home / "Engine idle / stale" on Signals** — the scheduled checker
  missed its slot (it runs on a free scheduler that is sometimes 5–15 minutes late). It
  catches up on the next pass; nothing is lost, because every pass recomputes the full
  picture.
- **"Nothing open right now" on Home** — normal. Most of the day there is no live idea;
  the card tells you when the bot checks next.
- **No signals today** — quiet days happen, especially for Tier A. The pace dots simply
  stay empty. That is information too.
- **"Signal feed unreachable"** — your device is offline or the database is briefly
  unavailable. The page retries every minute on its own.

---

*Manual version: matches the app as of 2026-07-23. If the app has changed since, the
Guide page in the app is the up-to-date reference (this file is regenerated from it —
see CLAUDE.md in the repository).*
