# Aegis Futures Lab — User Manual

*For traders and for anyone curious. Everything you need to use the app, in plain language.*

Live app: https://aegis-futures-lab-khaki.vercel.app
This manual is also inside the app on the **Guide** page (More → Guide).

---

## 1. Start here

Aegis has a bot that watches two stock-index futures — the S&P micro (MES) and the Nasdaq micro (MNQ) — and tests trading methods on them. It shows you what it finds in plain words, and it keeps an honest score.

The short version today: **no method has beaten chance yet**, so the bot has not traded its practice money. Meanwhile its **experimental learner** trades a separate $10,000 of **virtual money** by itself and learns under fixed rules, so you can watch it work. That is evidence being collected, not proof that anything makes money. The trade ideas you see are a record of what the methods do, not advice.

> **Nothing here touches real money.** There is no broker connection. Prices are delayed 10–15 minutes and trade ideas arrive 5–15 minutes after the setup. Use the app to practice, learn and keep score — never as a live trade instruction.

## 2. The five tabs

| Tab | What it answers |
|---|---|
| **Today** | What the experimental learner is doing, what happened to its virtual money and what it last learned. Then the two markets, the practice money, the latest trade ideas and any big news coming up. |
| **Trades** | Every idea the learner decided on, taken or skipped, with the reason. Tap one for the evidence: the values saved when it decided, the simulated fill, the exit, costs and the result. |
| **Learn** | The model in charge, the candidates being tested, every review's verdict and the full change history. Then historical practice on older market data. Below that: the bot's health, its Watch → Test → Practice path and the practice money. |
| **Chart** | Prices, the price areas the bot watches, the learner's virtual trades as arrows, why there is no idea right now, and the big news it steps aside for. |
| **More** | Trade ideas (Ideas) and their history (Review), practice money, historical practice, your Journal, this Guide, settings (ET or IST, hide money) and the research room. |

Any word with a dotted underline can be tapped for a short meaning. Close a sheet with its ✕ or Escape.

## 3. How to read a trade idea

1. **Buy or Sell, and which market.** "Sell · Nasdaq micro" means the idea expected the Nasdaq micro to fall.
2. **The badge.** A red "Method hasn't beaten chance" means the method behind it was tested on years of prices and did no better than random entries. Amber "Not tested yet" means nobody has checked.
3. **The bar.** Stop on the left, target on the right, the white tick is the entry. The red part is the room to be wrong; the green part is how far it aimed. A ring shows where it ended.
4. **The sentence.** "Exits at X if wrong (−$Y per contract) or Z if right (+$W)" turns the prices into dollars for one contract. MES moves $5 a point, MNQ $2 a point.
5. **The ending.** Reached its target, Stopped out, Closed before stop or target, Open now — or "Not resolved yet" when the bot has not recorded how an old idea finished. Results are after costs.
6. **Details.** Tap a card for why the bot took it and, under "How this kind of idea has done", the numbers with their sample sizes.

## 4. The experimental learner

The learner is the bot's own **virtual $10,000** account. Every 15 minutes it reads the newest finished price bars, manages its open trades and decides on every new trade idea: take it, or skip it with a reason. Skipped ideas are followed too, so it cannot learn only from its own winners.

1. **Limits.** At most $100 at risk on one trade and $200 across open trades. A $400 daily loss stops it until the next session. A $2,000 drop from its best stops the campaign for good. It never raises risk after a loss, and a new campaign keeps the earlier losses on record.
2. **Honest fills.** An order fills on the next price after the decision, with costs on both sides. A bar that touches both stop and target counts as the stop. A gap through the stop fills at the worse price. With no fresh price it takes no new trades and never invents an exit.
3. **Nightly.** Finished trades go into a numbered learning record. Nothing is learned from a single loss.
4. **Weekly.** It may test up to 3 new model versions from a fixed list, side by side with the current one on the same fresh ideas. A new version takes over only after 150 results it never trained on, 20 fresh trading days, 60 fresh ideas and two passing reviews at least 6 days apart. It must clearly beat the current model, not trading at all and random picks, after costs. The old version is kept and comes back automatically if the new one does worse.
5. **How long a test lasts.** At most 3 candidates are tested at a time, each for up to 52 weeks, because fresh results come slowly — about one usable idea a day. A candidate is retired after 6 inconclusive reviews in a row once it has 150 results it never trained on, or after 52 weeks without a passing review. A new candidate takes the free place.
6. **Why 50 is not enough.** Training can start at 50 finished trades. A fair review splits the record into 6 blocks by date, and each of its 5 test periods needs 50 earlier trades to learn from — roughly 300. Periods that are too thin are shown and skipped, never counted. Ideas too risky for one contract are not counted at all.

Three labels show its state, each with a reason. **Doing**: watching the market, managing trades, waiting, paused, stopped, last check failed or status unknown. **Learning**: collecting results, candidate ready, change adopted, candidate rejected or no proven gain yet. **Data**: current, late, stale or offline. A missing check reads "status unknown", never "running". "No proven gain yet" is an honest result, not a fault.

Ideas seen more than 30 minutes late are labelled "caught up late" and never count as fresh evidence. Synthetic test prices, if ever used, are labelled on every screen and never count as evidence. Only the owner can pause it, through the project's GitHub controls. Offline, the app is read-only.

## 5. Historical practice

The bot also replays its own older market archive — the S&P and Nasdaq micros from 6 May 2019 to 23 September 2026 — to prepare a better candidate. It is practice on old data, kept apart from everything else.

1. **Only what it could know then.** At each old idea it decides with the prices it could have seen at that moment, about 25 minutes late like the live learner, at the next 15-minute check. Fills, costs, stops and limits work exactly as in the live learner. Gaps and contract-roll jumps in the old data are marked and the ideas near them left out — never patched.
2. **Counted once.** Each idea counts once, however many copies the records hold. Ideas too risky for one contract under the $100 limit are not counted.
3. **Rules first.** The dates, the 3 versions to try and every check were frozen before any old result was read. The oldest 60% of trading days trains, the next 20% checks, and the newest 20% is tested once. All 3 versions are kept, including the ones that fail.
4. **Fair comparisons.** Each version is compared on the same ideas with the current model, a simple average-rate guess, not trading at all and random picks — with costs doubled as a stress test and with the same account limits.
5. **Already seen.** Earlier research has looked at all of these dates, so the result is marked "already seen": practice, not proof.
6. **Then fresh ideas.** A candidate that is not rejected is frozen and watches new ideas beside the current model without changing a single decision. It must then pass every adoption check on fresh ideas — 20 fresh trading days, 60 fresh ideas and two passing reviews — like any other candidate. Old data counts for none of these.

Learn → Historical practice shows an evidence checklist: **Data ready**, **Historical test complete**, **Fresh confirmation collecting** and **Validated paper improvement**. There is no maturity score, and the last line never means proven for real money. "No validated improvement yet" is an honest result, not a fault.

The study never refills or resets the virtual account and never adds old profit to it. It runs at $0 on data the project already holds, in short capped runs, and pauses itself when the free limits run low.

## 6. Three kinds of money — never mixed

**Trade ideas** are a simulated record: what each method would have done, followed to the end on delayed prices. Their results show on Today, Ideas and Review.

**The experimental learner** trades its own virtual $10,000, separately. Its results show on Today, Trades and Learn, and are never added to the other two.

**Practice money** is the bot's own $10,000 paper account. It only trades once a method has passed every test, so it has not traded yet. It shows on Today and Learn.

Historical practice is not money at all: its results on older data stay on Learn and are never added to any of the three.

## 7. How the bot earns the right to trade

1. **Watch.** Every 15 minutes, all futures week, the bot reads prices and posts any idea its methods spot. New ideas only start between 02:00 and 15:25 New York time (11:30–00:55 IST while the US is on summer time, 12:30–01:55 IST in winter), and everything is closed by 15:25 New York time.
2. **Test.** A method must beat thousands of random entries on years of past prices, pass a separate confirmation period, then earn 60 new trades over 20 trading days and two weekly reviews. Past replays never count as new trades.
3. **Practice.** Only then does it trade practice money — first at $50 of risk a trade, then up to $100 (1% of the account). All open trades together risk at most $200. A $400 daily loss stops it for the day, and a $2,000 drop from its high locks the account until someone resets it.

Every week the bot also tests any method marked "Not tested yet" against random entries by itself, and reports the result on Learn. It never promotes a method on its own — a person has to.

Too little evidence is shown in amber, never red: too little data is not a loss. Red is only for a measured loss. Every rate is shown with its n, and below 30 trades it is marked "previewed, not judged".

## 8. Is the bot working?

| Word | Meaning |
|---|---|
| **Running** | Price checks are arriving every 15 minutes. |
| **Resting** | The market is closed (weekends, holidays). That is the schedule, not a fault. |
| **Prices delayed / Running late** | The feed or a check is behind. Ideas catch up on the next pass. |
| **Needs attention** | Part of a check had a problem, such as the practice account update. Trade ideas are still checked. |
| **Last check failed** | The newest check errored. The next one runs within 15 minutes; a watchdog alerts if it keeps failing. |

The bell in the header lists anything worth a look. Its dot is amber for a warning and red only when something failed. News notes alone do not light it.

## 9. Your journal

More → Journal is yours alone. Pick the trading day, type in a trade or import your broker's file (Tradovate and Topstep exports work), and export it any time. Entry and exit times are typed in New York time to match the chart. Sign in with your email to keep a private copy across devices; local saving always works.

"Compare with the bot" re-runs the zone method over 60 days in your browser and shows what it did on your days. It takes a few seconds, so it only loads when you open it.

## 10. ET or IST

Times follow the ET/IST switch in the header (also under More → Settings). Phones in India start on IST. Two things stay in New York time on purpose: trading days (a day's ideas group by the New York date) and journal entry times. Session rules print both clocks in the app.

## 11. The research room

More → Research room holds the raw tools: the Strategy Lab (test a method on past prices yourself), Diagnostics (the beat-random test, market-year by market-year) and Data (import price files, replay a past day). They use statistics words on purpose; tap any underlined word, or see the list below.

Methods carry their standing everywhere: **red "hasn't beaten chance"** means tested and failed; **amber "not tested yet"** means unknown. Lab results never become trade ideas.

## 12. Put it on your phone

iPhone: open the site in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap ⋮, then Add to Home screen. It opens straight onto Today.

## 13. Words you'll see

| Word | Meaning |
|---|---|
| **Paper trading** | Practice trades with imaginary money. Every trade in this app is a paper trade. Nothing here touches real money. |
| **Delayed prices** | Prices here are 10 to 15 minutes old, and trade ideas arrive 5 to 15 minutes after the setup. Never use them as a live order. |
| **Practice money** | The bot's own $10,000 paper account. It only trades once a method has passed every test. Trade ideas are a separate record. |
| **Experimental learner** | The bot's own virtual $10,000 account. It takes trade ideas by itself, records every take and skip, and learns under fixed rules. Its results are evidence being collected, not proof. |
| **Virtual equity** | What the learner's pretend account is worth now: $10,000 plus finished results plus an estimate for open trades. It is pretend money only. |
| **Model version** | The rule the learner uses to take or skip ideas. Version 1 takes every idea. Later versions are small models trained on the learner's own finished trades. |
| **Candidate** | A new model version tested side by side with the current one on the same fresh ideas. It takes over only after every check passes, twice. |
| **Rolled back** | A version that took over was put back to the previous one because it did worse or gave an unusable answer. A rolled-back version can never return. |
| **Shadow result** | What an idea would have done with one contract, whether the learner took it or not. It lets the learner learn from skipped ideas too. |
| **Synthetic prices** | Made-up test prices used to prove the software works. Results on them never count as evidence that anything makes money. |
| **Historical practice** | The bot replays older market data, deciding each idea only with what it could have known then. It can prepare a candidate, but never counts as fresh trading days and never changes the virtual account. |
| **Already seen** | A stretch of older data that earlier research has already looked at. A result on it is practice, not proof, because the methods were shaped while looking at it. |
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
| **Drawdown** | How far the account has fallen from its highest point. A $2,000 drawdown locks the practice account until it is reset. |
| **Beat-random test** | The method's trades are compared with thousands of random entries on the same days. If it cannot beat random entries, it has no real edge. |
| **Hasn't beaten chance** | The method was tested on years of data and did no better than random entries. Its ideas are kept as a record, not as advice. |
| **Not tested yet** | Nobody has run the beat-random test on this method yet. Untested is not the same as losing — it just isn't known. |
| **New trades** | Trades the bot recorded live, as the prices arrived. Past replays never count, so a method has to prove itself going forward. |
| **Qualify** | To trade practice money a method needs: a passed history test, a separate confirmation, 60 new trades over 20 trading days, and two weekly reviews. |
| **Probation** | A newly qualified method trades practice money at half risk ($50 per trade) until another weekly review passes. |
| **Zone setup and daily flow** | The two kinds of trade ideas. Zone setups are rare returns to strong price areas. Daily flow fades short sharp moves, at most twice a day. |
| **Paused by the breaker** | When a kind of idea loses too often lately, the bot keeps simulating it but hides it from the results until it recovers. |
| **Journal** | Your own trades, typed in or imported from your broker. They stay separate from the bot and are private to you. |

## 14. If something looks wrong

- A warning with "Try again" means a read failed; the screen keeps the last good numbers.
- An idea marked "Not resolved yet" is left out of every total until the bot records its end.
- A dash (—) means there is no number yet, not zero.
- An open learner trade marked "~" or "stale" has no fresh price; its result is an estimate.
- Still stuck? Check the bell, then Learn → health. The research drawers on Ideas show every excluded row.

---

*Manual version: matches the app as of 2026-10-07 (candidate testing time). If the app has changed since, the in-app Guide is the source of truth.*
