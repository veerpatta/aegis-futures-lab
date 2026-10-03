# Aegis Futures Lab — User Manual

*For traders and for anyone curious. Everything you need to use the app, in plain language.*

Live app: https://aegis-futures-lab-khaki.vercel.app
This manual is also inside the app on the **Guide** page (More → Guide).

---

## 1. Start here

Aegis has a bot that watches two stock-index futures — the S&P micro (MES) and the Nasdaq micro (MNQ) — and tests trading methods on them. It shows you what it finds in plain words, and it keeps an honest score.

The short version today: **no method has beaten chance yet**, so the bot is still testing and has not traded its practice money. The trade ideas you see are a record of what the methods do, not advice.

> **Nothing here touches real money.** There is no broker connection. Prices are delayed 10–15 minutes and trade ideas arrive 5–15 minutes after the setup. Use the app to practice, learn and keep score — never as a live trade instruction.

## 2. The five tabs

| Tab | What it answers |
|---|---|
| **Today** | Is the bot working and trading? The two markets, the practice money, the latest trade ideas and any big news coming up. |
| **Ideas** | Every trade idea, open or finished. The verdict on the methods sits at the top; "For researchers" at the bottom holds every number behind the cards. |
| **Chart** | Prices, the price areas the bot watches, why there is no idea right now, and the big news it steps aside for. |
| **Bot** | Where the bot is on its Watch → Test → Practice path, its health, the practice money and each method's progress. |
| **More** | Your Journal and Review, this Guide, settings (ET or IST, hide money) and the research room. |

Any word with a dotted underline can be tapped for a short meaning. Close a sheet with its ✕ or Escape.

## 3. How to read a trade idea

1. **Buy or Sell, and which market.** "Sell · Nasdaq micro" means the idea expected the Nasdaq micro to fall.
2. **The badge.** A red "Method hasn't beaten chance" means the method behind it was tested on years of prices and did no better than random entries. Amber "Not tested yet" means nobody has checked.
3. **The bar.** Stop on the left, target on the right, the white tick is the entry. The red part is the room to be wrong; the green part is how far it aimed. A ring shows where it ended.
4. **The sentence.** "Exits at X if wrong (−$Y per contract) or Z if right (+$W)" turns the prices into dollars for one contract. MES moves $5 a point, MNQ $2 a point.
5. **The ending.** Reached its target, Stopped out, Closed before stop or target, Open now — or "Not resolved yet" when the bot has not recorded how an old idea finished. Results are after costs.
6. **Details.** Tap a card for why the bot took it and, under "How this kind of idea has done", the numbers with their sample sizes.

## 4. Two kinds of money — never mixed

**Trade ideas** are a simulated record: what each method would have done, followed to the end on delayed prices. Their results show on Today, Ideas and Review.

**Practice money** is the bot's own $10,000 paper account. It only trades once a method has passed every test, so it has not traded yet. It shows on Today and Bot.

## 5. How the bot earns the right to trade

1. **Watch.** Every 15 minutes, all futures week, the bot reads prices and posts any idea its methods spot. New ideas only start between 02:00 and 15:25 New York time (11:30–00:55 IST while the US is on summer time, 12:30–01:55 IST in winter), and everything is closed by 15:25 New York time.
2. **Test.** A method must beat thousands of random entries on years of past prices, pass a separate confirmation period, then earn 60 new trades over 20 trading days and two weekly reviews. Past replays never count as new trades.
3. **Practice.** Only then does it trade practice money — first at $25 of risk a trade, then up to $50. All open trades together risk at most $100. A $200 daily loss stops it for the day, and a $1,000 drop from its high locks the account until someone resets it.

Every week the bot also tests any method marked "Not tested yet" against random entries by itself, and reports the result on Bot. It never promotes a method on its own — a person has to.

Too little evidence is shown in amber, never red: too little data is not a loss. Red is only for a measured loss. Every rate is shown with its n, and below 30 trades it is marked "previewed, not judged".

## 6. Is the bot working?

| Word | Meaning |
|---|---|
| **Running** | Price checks are arriving every 15 minutes. |
| **Resting** | The market is closed (weekends, holidays). That is the schedule, not a fault. |
| **Prices delayed / Running late** | The feed or a check is behind. Ideas catch up on the next pass. |
| **Needs attention** | Part of a check had a problem, such as the practice account update. Trade ideas are still checked. |
| **Last check failed** | The newest check errored. The next one runs within 15 minutes; a watchdog alerts if it keeps failing. |

The bell in the header lists anything worth a look. Its dot is amber for a warning and red only when something failed. News notes alone do not light it.

## 7. Your journal

More → Journal is yours alone. Pick the trading day, type in a trade or import your broker's file (Tradovate and Topstep exports work), and export it any time. Entry and exit times are typed in New York time to match the chart. Sign in with your email to keep a private copy across devices; local saving always works.

"Compare with the bot" re-runs the zone method over 60 days in your browser and shows what it did on your days. It takes a few seconds, so it only loads when you open it.

## 8. ET or IST

Times follow the ET/IST switch in the header (also under More → Settings). Phones in India start on IST. Two things stay in New York time on purpose: trading days (a day's ideas group by the New York date) and journal entry times. Session rules print both clocks in the app.

## 9. The research room

More → Research room holds the raw tools: the Strategy Lab (test a method on past prices yourself), Diagnostics (the beat-random test, market-year by market-year) and Data (import price files, replay a past day). They use statistics words on purpose; tap any underlined word, or see the list below.

Methods carry their standing everywhere: **red "hasn't beaten chance"** means tested and failed; **amber "not tested yet"** means unknown. Lab results never become trade ideas.

## 10. Put it on your phone

iPhone: open the site in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap ⋮, then Add to Home screen. It opens straight onto Today.

## 11. Words you'll see

| Word | Meaning |
|---|---|
| **Paper trading** | Practice trades with imaginary money. Every trade in this app is a paper trade. Nothing here touches real money. |
| **Delayed prices** | Prices here are 10 to 15 minutes old, and trade ideas arrive 5 to 15 minutes after the setup. Never use them as a live order. |
| **Practice money** | The bot's own $10,000 paper account. It only trades once a method has passed every test. Trade ideas are a separate record. |
| **Trade idea** | A buy or sell setup the bot spotted and then followed to its end on delayed prices. It is a simulated record, not a trade in the practice account. |
| **MES · S&P micro** | The Micro E-mini S&P 500 future. Each 1-point move is worth $5 per contract. |
| **MNQ · Nasdaq micro** | The Micro E-mini Nasdaq-100 future. Each 1-point move is worth $2 per contract. |
| **Entry** | The price where the idea gets in. |
| **Stop** | The price that proves the idea wrong. If price reaches it, the trade closes with a planned loss. Fast markets can fill a little beyond it. |
| **Target** | The price where the idea takes its profit. |
| **Reward to risk** | How far the target is compared with the stop. 1.5 : 1 means the possible gain is one and a half times the possible loss. |
| **Zone** | A price area where strong buying or selling showed up before. Buy areas sit below price, sell areas above it. |
| **Fresh zone** | A zone price has not come back to yet. Tested means it has been touched once already. |
| **Flat by 15:25 ET** | Every idea closes by 15:25 New York time, just before the session ends. No overnight positions. |
| **News pause** | The bot takes no new ideas from 30 minutes before to 30 minutes after big US news like CPI, jobs or a Fed decision. |
| **Win rate** | The share of closed trades that made money. A high win rate can still lose money if the losses are bigger than the wins. |
| **Profit factor** | Money won divided by money lost. Above 1 means winners outweigh losers; below 1 means the method lost money. |
| **Expectancy** | The average result per trade after costs. Below zero means each trade loses money on average. |
| **n (sample size)** | How many trades a number is based on. Under 30 is too few to judge, so those numbers are shown faded and marked amber. |
| **Likely range** | Where the true value probably sits, given how few trades there are. A wide range means the number could easily be luck. |
| **Costs** | Commission ($1.20 per side per contract) and one tick of slippage on the way in and out. Every result here is after costs. |
| **Slippage** | Getting filled at a slightly worse price than planned. The app charges it on every trade. |
| **Equity** | What the practice account is worth right now, including any open trade. |
| **Open risk** | How much the practice account could lose if every open trade hit its stop. |
| **Drawdown** | How far the account has fallen from its highest point. A $1,000 drawdown locks the practice account until it is reset. |
| **Beat-random test** | The method's trades are compared with thousands of random entries on the same days. If it cannot beat random entries, it has no real edge. |
| **Hasn't beaten chance** | The method was tested on years of data and did no better than random entries. Its ideas are kept as a record, not as advice. |
| **Not tested yet** | Nobody has run the beat-random test on this method yet. Untested is not the same as losing — it just isn't known. |
| **New trades** | Trades the bot recorded live, as the prices arrived. Past replays never count, so a method has to prove itself going forward. |
| **Qualify** | To trade practice money a method needs: a passed history test, a separate confirmation, 60 new trades over 20 trading days, and two weekly reviews. |
| **Probation** | A newly qualified method trades practice money at half risk ($25 per trade) until another weekly review passes. |
| **Zone setup and daily flow** | The two kinds of trade ideas. Zone setups are rare returns to strong price areas. Daily flow fades short sharp moves, at most twice a day. |
| **Paused by the breaker** | When a kind of idea loses too often lately, the bot keeps simulating it but hides it from the results until it recovers. |
| **Journal** | Your own trades, typed in or imported from your broker. They stay separate from the bot and are private to you. |

## 12. If something looks wrong

- A warning with "Try again" means a read failed; the screen keeps the last good numbers.
- An idea marked "Not resolved yet" is left out of every total until the bot records its end.
- A dash (—) means there is no number yet, not zero.
- Still stuck? Check the bell, then Bot → health. The research drawers on Ideas show every excluded row.

---

*Manual version: matches the app as of 2026-10-03 (plain-language mobile redesign). If the app has changed since, the in-app Guide is the source of truth.*
