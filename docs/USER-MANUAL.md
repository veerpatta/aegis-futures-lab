# Aegis Futures Lab — User Manual

*For traders and for anyone curious. Everything you need to use the app, in plain language.*

Live app: https://aegis-futures-lab-khaki.vercel.app
This manual is also inside the app on the **Guide** page (More → Guide).

---

## 1. Start here

Aegis has a bot that watches two stock-index futures — the S&P micro (MES) and the Nasdaq micro (MNQ) — and tests trading methods on them. It shows you what it finds in plain words, and it keeps an honest score.

Aegis uses one **virtual $10,000 account**. Its **experimental learner** simulates trades on delayed prices and keeps an honest record of fills, costs and skips. **No method has beaten chance yet.** Virtual trading is practice, not proof that anything makes money. Trade ideas are not advice.

> **Nothing here touches real money.** There is no broker connection. Prices are delayed 10–15 minutes and trade ideas arrive 5–15 minutes after the setup. Use the app to practice, learn and keep score — never as a live trade instruction.

A free AI from NVIDIA's trial service gives a **second opinion** on each idea the bot decides. It never changes a trade, and its calls are scored honestly against simple alternatives (section 4).

## 2. The five tabs

| Tab | What it answers |
|---|---|
| **Today** | Is the bot working, how is the virtual money, what happened today in plain words, the last three trades, whether it is learning, the two markets and the next big news. On a computer it shows two columns. |
| **Trades** | Every decision of the current campaign, taken or skipped, as one list under a summary. Tap one for its story: the result, what happened in plain words, the price bar, the timeline and costs, then (folded) the rule and the values saved when it decided. |
| **Learn** | Learning progress, who is in charge and the AI helper: the AI second opinion's scoreboard and the rules the AI is testing. Folded below: change history, how learning works, the bot's recent jobs, Ask the AI, owner controls, historical practice and method research. |
| **Chart** | Prices, the price areas the bot watches, the learner's virtual trades as arrows, why there is no idea right now, and the next big news it steps aside for. |
| **More** | Records (Method ideas, Results calendar, My journal), Help (this Guide), Settings (ET or IST, hide money) and the Research room. |

Any word with a dotted underline can be tapped for a short meaning. Close a sheet with its ✕ or Escape. A section marked ▸ is folded; tap it to open. Folded sections load only when opened, so the main screens stay short.

### Read the widgets

- **Status card.** The top card on Today says what the bot is doing, with open trades, trades closed today and the next expected check. Tap a count to open Trades.
- **Timer.** The pill beside the headline says whether the bot is on time. "On time" means checks every 15 minutes. "Running late" means GitHub's free timer started the bot hours late; "How to fix it" opens the one-time, free setup in section 8. Late is amber, never red. A red "Timer key refused" means the key needs renewing.
- **Virtual balance.** The large number is what the account is worth now, after costs, with today's closed result and the change since this campaign began. The line joins the starting balance, saved daily closes and the latest estimate; it is not a tick-by-tick chart, and open results can still change. Rules opens the account's limits.
- **Today in plain words.** A few sentences built only from the account's own record. When the owner is signed in, an AI-written note can take their place; it is labelled "Written by AI" and is shown only if every number in it matches the record.
- **Why it has been quiet.** When nothing is open or closed today, Today lists the saved reasons from the past week: skipped ideas and why, methods paused by their loss guard, or no ideas at all.
- **Trade rows.** Each row on Today and Trades shows the market, Buy or Sell, the method and the time, then the result after costs. An open trade's result is an estimate marked "~"; a skipped idea says "Not taken". Waiting and cancelled orders never show a made-up result. When the owner is signed in, a small "AI: take" or "AI: skip" shows the AI's second opinion. Tap a row for its story.
- **Find a trade.** Use the filter row at the top of Trades: All, Taken, Skipped, Open, Closed or Past campaigns.
- **Is it learning?** Today's learning card shows the version in charge, what the learner is doing, the next learning check and one line on the AI second opinion. Tap it for Learn.
- **Market tiles.** Each price shows its change since yesterday's settle, marked "today". Tap a tile to open its chart.
- **Market clock and price range.** Chart shows time left in the entry window. Its ring follows that window, including early closes. The price range marks the last close between the low and high of the loaded candles. The dates below say which period it covers. It is not a forecast.
- **Find a tool.** In More, search for a tool by name or what it does. Clear the search to see all tools and the settings. These display settings stay on your device.
- **Learning progress.** On Learn, the ring counts usable examples toward the 50 needed to start training. It is not a score of skill or profitability. A fair review and fresh confirmation need more evidence.
- **More detail, when needed.** Folded sections hold the research detail: Under the hood on Trades and Learn, the rule and saved values on each trade, the engine's counts on Chart. Your phone's reduced-motion setting turns off the animations. Hide money also hides the account chart.

## 3. How to read a trade idea

1. **Buy or Sell, and which market.** "Sell · Nasdaq micro" means the idea expected the Nasdaq micro to fall.
2. **The badge.** A red "Method hasn't beaten chance" means the method behind it was tested on years of prices and did no better than random entries. Amber "Not tested yet" means nobody has checked.
3. **The bar.** Stop on the left, target on the right, the white tick is the entry. The red part is the room to be wrong; the green part is how far it aimed. A ring shows where it ended.
4. **The sentence.** "Exits at X if wrong (−$Y per contract) or Z if right (+$W)" turns the prices into dollars for one contract. MES moves $5 a point, MNQ $2 a point.
5. **The ending.** Reached its target, Stopped out, Closed before stop or target, Open now — or "Not resolved yet" when the bot has not recorded how an old idea finished. Results are after costs.
6. **Details.** Tap a card for why the bot took it and, under "How this kind of idea has done", the numbers with their sample sizes.

### The time machine

Open any bot trade and tap **Time machine** for the honest odds before that trade. It replays the rest of that trading day 10,000 times. Each replay is built from the bot's own delayed 5-minute prices at the same time of day on the 59 full trading days before the trade. It never uses that day's prices or later ones.

- **Target first, Stop first, Still open.** How the 10,000 replays ended. Still open means neither was reached by the close. The bot's own rules apply: the stop is checked first, a price bar that touches both counts as the stop, and everything is closed by 15:25 New York time.
- **The verdict.** "Close to a coin flip" or "Close to break-even" means the target came first about as often as it needed to just to break even. "Leans toward" and "Strongly toward" mean 5 and 15 points away from that. A farther target needs to win less often: 1 in 2 when it is as far as the stop, 1 in 3 when it is twice as far.
- **Costs.** The odds are before costs. One line puts back one contract's commission and slippage. With a tight stop, costs are a big share of the risk.
- **The past days.** The same stop and target, placed at the same time of day on each past day, on the real prices. It shows what that bracket did at that hour, whatever the idea said.

It is a simulation, not a prediction. News, a Fed day or a halt can do things those days never did. It needs at least 20 full past days, replays only 02:00 to 15:25 New York time (11:30–00:55 IST while the US is on summer time, 12:30–01:55 IST in winter), and does not run on short trading days. It never changes a trade.

### The time machine filter test

Can the time machine make the bot trade better? One rule was written down and locked before any result: skip an idea when the time machine's average replay, after one contract's costs, is below zero. Find it in Learn (or More → Time machine filter test).

- **On past ideas.** The same ideas the historical study replayed from 2019 to 2026 are rebuilt and checked first. Then the rule is judged once: it must beat taking every idea, beat random skips of the same size, and make money after costs. Those years were used by earlier research, so this is a check, not fresh evidence.
- **On new decisions.** Every new learner decision gets the filter's call within a day. Looks come at 60 and 150 finished ideas and are stored once. Each trade's time machine card says whether the filter would have taken or skipped it.
- **What a pass changes.** A pass on past ideas lets the filter shadow in the learner as a new candidate. The learner's own rules then decide whether it ever takes charge of trades. A fail or an unclear result changes nothing.

## 4. The experimental learner

### Meet the bot on Learn

Learn opens with **My learning notebook**: usable examples at the last recorded check, with its date, plus versions trained, changes adopted and fresh results. Taken and skipped ideas can both supply examples. A bigger count is more evidence, not proof of better trading. The next milestone explains what is missing. Open **The path to a better bot** for all the steps.

**Working on its own** shows expected check, notebook and review times in your selected clock. The jobs continue when you close the app. **Who is in charge** names the version deciding now and since when. The **AI helper** cards follow: the AI second opinion and the ideas the AI is testing (below).

Open **Under the hood · the bot's recent jobs** for the animated bot and the job log. The bot shows the latest recorded activity: watching for ideas, following virtual trades, organising examples, testing versions, waiting or needing attention. Watching means it is between scheduled checks, not training continuously. Offline or when a job has not reported back, the animation stops and the reason stays visible. You can pause the animation. It also rests off screen and follows your phone's reduced-motion setting. **Recent activity** shows recorded job times and outcomes. Open **Example quality at the last check** for usable examples, waiting outcomes and exclusions. Its date matters; it is a report from that check.

### The AI second opinion

A free AI model on NVIDIA's trial service reads the facts the bot had when it decided each idea: the market, Buy or Sell, the method, its stop and target, and how prices moved in the hours before. It says whether it would take the idea, how sure it is and why. It is asked within two hours of the decision and only sees prices up to the decision time. **It never changes a trade.**

Its calls are scored against taking every idea, against random picks of the same size and against not trading, after costs, using each idea's one-contract result. The rules were written down before its first call. The first fair check comes after 60 finished calls over 15 trading days; the final one after 150. Until then the scoreboard says "Too early to tell" in amber. Only a passed check makes the AI eligible to filter trades, and only if the owner starts a new campaign for it.

You asked for Kimi, and then for DeepSeek. NVIDIA lists Kimi K3.1 Pro but has not switched on its API for free keys yet, and Kimi K2.6 is not served to free accounts. DeepSeek V4.1 Flash is listed too, but on 6 November its servers did not answer. Until one of them answers, the second opinion comes from NVIDIA's own Nemotron 3 Ultra. The helper checks both every six hours. Each starts its own study the moment it answers, so evidence from different models is never mixed. Its opinion is then the one shown on trades, Kimi first, while the Nemotron study carries on. Once DeepSeek has answered, the AI's notes and Ask the AI use it too. A model that keeps failing is left alone for a while, so a slow one never holds up the rest.

NVIDIA's free key is for testing and evaluation. Its terms do not allow sharing AI-written text with the public, so the AI's words (its reasons, notes and answers) are shown only to the signed-in owner. Everyone else sees the scoreboard numbers, which the app works out itself. NVIDIA may use what is sent to improve its models; only market facts and the bot's own records are sent. It costs nothing: the free service has no billing.

### AI research ideas

Each week the AI studies the bot's finished trades and suggests up to three simple rules for ideas to skip, such as "skip sells when price is far above the day's average". The app writes each rule down with the time it was proposed, then tests it **only on trades that come after it**: the trades the rule would keep, against taking every idea and against random skips of the same size, after costs. The first fair check comes after 60 such trades over 15 trading days; the final one after 150. Until then a rule shows "Too early to tell" in amber. Because several rules are tested at once, each must clear a stricter bar than a single test would.

A rule that passes is only eligible: the owner can add it to a new campaign, and nothing changes the running account. This is how the AI can help the bot improve without guessing: it suggests, and fresh trades decide.

The rules and the AI's weekly note ("This week the AI noticed…") are AI-written, so they are shown only to the signed-in owner. Everyone else sees each rule's numbers. To sign in, open Ask the AI on Learn.

The learner uses stored outcomes and small models on the existing service. It makes no paid AI calls or new data purchases. Identical training inputs share one calculation within a review. Unchanged datasets are reused. The normal review, risk and fresh-evidence requirements still apply. Usage limits can defer optional work; the app's usage guard is not a provider billing meter.

### Ask the AI

On Learn, open **Ask the AI about your bot** and sign in with an email code or your account password to ask about recorded evidence or suggest a research question. Your question and the bot's records go to the free AI model on NVIDIA's servers. Do not paste passwords, API keys or private journal details. The AI can be wrong; a cited record does not prove its answer. It cannot change the learner, its trades or the bot's rules. Deeper answers take longer. The free service is sometimes busy; if it is, try again a few minutes later. Each account has a daily limit on questions.

**Paid AI stays off** unless the owner turns it on with the server setting AEGIS_ALLOW_PAID_AI. While it is off nothing can be charged. If the owner ever turns it on, signed-in users share an Aegis allowance of up to $25 per month and paid requests may incur OpenAI charges. The bot, its trades and its learning never need AI.

Under Owner controls on Learn, the owner can request pause, resume, stop or start and enter a reason. The next learner check records whether the request was applied or failed; refresh to see the result. Pause prevents new virtual entries while existing trades are managed. Stop waits for open and pending trades to settle. Starting another campaign preserves earlier results. The owner can also change their password there.

The owner can run one AI connection check there. It uses a fixed test message and costs at most $0.01 on the configured OpenAI account. It does not start automatic AI processing. If the result is uncertain, do not retry; a reservation may still be counted in the allowance.

An earlier paid-AI shadow study stays dormant while paid AI is off; the AI second opinion above replaces it. Neither changes the learner's balance, and practice results are not proof of profitable trading or live-market performance.

The learner is the bot's own **virtual $10,000** account. After each complete market update, it processes ideas and price bars in market-time order. The simulation stays 30 minutes behind received prices so source checks can finish before it passes an idea. This planned wait is separate from feed delay. It decides after the idea's bar closes and fills on the next available bar. It only uses prices available at that simulated moment. Skipped ideas are followed too, so it cannot learn only from its own winners.

1. **Limits.** At most $100 at risk on one trade and $200 across open trades. A $400 daily loss stops it until the next session. A $2,000 drop from its best stops the campaign for good. It never raises risk after a loss, and a new campaign keeps the earlier losses on record.
2. **Honest fills.** An order fills on the next price after the decision, with costs on both sides. A bar that touches both stop and target counts as the stop. A gap through the stop fills at the worse price. If the next market period has no price, the order waits; the app never invents a price. It can fill fewer contracts if risk is higher at the opening price. Filled trades show the actual size. Waiting and cancelled orders are labelled separately.
3. **Nightly.** Finished trades go into a numbered learning record. Nothing is learned from a single loss.
4. **Weekly.** It may test up to 3 new model versions from a fixed list, side by side with the current one on the same fresh ideas. A new version takes over only after 150 results it never trained on, 20 fresh trading days, 60 fresh ideas and two passing reviews at least 6 days apart. It must clearly beat the current model, not trading at all and random picks, after costs. The old version is kept and comes back automatically if the new one does worse.
5. **How long a test lasts.** At most 3 candidates are tested at a time, each for up to 52 weeks, because fresh results come slowly — about one usable idea a day. A candidate is retired after 6 inconclusive reviews in a row once it has 150 results it never trained on, or after 52 weeks without a passing review. A new candidate takes the free place.
6. **Why 50 is not enough.** Training can start at 50 finished trades. A fair review splits the record into 6 blocks by date, and each of its 5 test periods needs 50 earlier trades to learn from — roughly 300. Periods that are too thin are shown and skipped, never counted. Ideas too risky for one contract under the campaign's limits are not counted at all.

### Campaign 3 rules (6 November 2026)

A new campaign uses three changes, written down before it starts. Every evidence check, the list of versions to try and every other limit stay the same. Campaign 2 keeps its own rules until it is stopped.

1. **Every idea.** It decides on every filled idea from every method, including methods their loss guard has paused. Each decision shows that the method was paused. Before, a fully paused source left it with nothing to decide: from 16 to 30 October it saw no ideas at all.
2. **One micro contract.** When a single contract alone risks more than $100 but no more than $150, it may take that one contract, still inside the $200 open and $400 daily limits. Most Nasdaq micro ideas have wide stops, so before this nearly all of them were skipped.
3. **Fresh evidence.** A decision processed within 2 hours of its market time counts as fresh, so a candidate can finally qualify. A later backlog stays replay. Before, every delayed decision was replay, so no candidate could ever take over.

The ideas still come from methods that have not beaten chance. More trades most likely mean more virtual losses. The point is evidence, not profit.

Its state shows in plain words, each with a reason. Today's status card says what it is doing (watching the market, managing trades, waiting, paused, stopped, last check failed or status unknown) and warns when data is late, stale or offline. The learning card says where learning stands: collecting results, candidate ready, change adopted, candidate rejected or no proven gain yet. A missing check reads "status unknown", never "running". "No proven gain yet" is an honest result, not a fault.

The repaired account replays ideas from 7 October 2026. Those trades and later delayed-market fills are labelled "Simulated on delayed prices". The time of the simulated decision and the actual time the idea was received are shown separately. Earlier campaigns' decisions remain under Trades → Past campaigns. Under campaign 1 and 2 rules, replay results can help train and test candidates, but never count as fresh evidence for a model taking over. Synthetic test prices never count as market evidence. Only the owner can pause it through the project's GitHub controls. Offline, the app is read-only.

### Behind the trades

At the bottom of Trades, open **Under the hood · how today's ideas reached the bot** for the day's source checks, eligible ideas, accepted ideas, filled trades, cancelled orders and learner skips. Accepted does not mean filled. Filled and cancelled counts follow decisions from the selected day, even if an order finishes later. Open an unfilled order for its reason. Choose a date in ET or IST. These are calendar-day counts; source setup checks below them follow the New York trading session.

Practice finished counts closed practice outcomes for those decisions. Ready for check counts results with the saved details needed for learning; the next learning check still applies its time cutoff and counts each idea once. Open Recorded decisions to follow each decision to its fill and learning status.

Account timing separates prices received from prices already simulated. A healthy feed can be ahead of the simulation while source checks finish. Truly late corrections are still skipped. Earlier fills, skips and balances are never rewritten to make activity look better.

Open a source method to see why its loss guard paused it and how its separate practice results are recovering. The guard pauses below a 0.80 profit-to-loss ratio over 20 usable closed results. It resumes after 15 in-pause results reach 1.10, or have wins with no losses, with at least three trading days between changes. A full progress bar alone does not pass the guard. Practice continues during a pause and never changes the learner's balance.

Open Paused method practice to see the selected day's recorded source simulations. Stale prices and uncertain fills are labelled. These results can change when the source price history changes; revised-away ideas stay visible but are not counted as results. These source results never change the learner's balance or count as a new study. Under campaign 3 rules the learner makes its own decision on each paused method's idea; under earlier rules it never sees them. If the loss guard cannot be checked, the source check stops and no new batch is published until a later check succeeds.

Open a skipped decision for its saved comparison: contract risk and remaining allowance, model odds and required odds, or the missing prerequisite. Older records may lack these values; the app says so. Decision time, receipt time, saved time and campaign context explain delayed processing. The check timeline separates normal waiting from missing prices, stale data and failed checks. A failed refresh shows a warning and keeps the last successful update for that day.

## 5. Historical practice

The bot also replays its own older market archive — the S&P and Nasdaq micros from 6 May 2019 to 23 September 2026 — to prepare a better candidate. It is practice on old data, kept apart from everything else.

1. **Only what it could know then.** At each old idea it decides with the prices it could have seen at that moment, using the historical study's original receipt-time rules, about 25 minutes late at the next 15-minute check. This study stays separate from the virtual account's delayed market clock. Gaps and contract-roll jumps in the old data are marked and the ideas near them left out — never patched.
2. **Counted once.** Each idea counts once, however many copies the records hold. Ideas too risky for one contract under the $100 limit are not counted.
3. **Rules first.** The dates, the 3 versions to try and every check were frozen before any old result was read. The oldest 60% of trading days trains, the next 20% checks, and the newest 20% is tested once. All 3 versions are kept, including the ones that fail.
4. **Fair comparisons.** Each version is compared on the same ideas with the current model, a simple average-rate guess, not trading at all and random picks — with costs doubled as a stress test and with the same account limits.
5. **Already seen.** Earlier research has looked at all of these dates, so the result is marked "already seen": practice, not proof.
6. **Then fresh ideas.** A candidate that is not rejected is frozen and watches new ideas beside the current model without changing a single decision. It must then pass every adoption check on fresh ideas — 20 fresh trading days, 60 fresh ideas and two passing reviews — like any other candidate. Old data counts for none of these. Practice results still go into the learning record. Under campaign 1 and 2 rules fresh confirmation waits while the account uses delayed simulations; campaign 3 counts promptly processed decisions as fresh. The older candidate remains saved.

Learn → Historical practice shows an evidence checklist: **Data ready**, **Historical test complete**, **Fresh confirmation waiting** and **Validated paper improvement**. There is no maturity score, and the last line never means proven for real money. "No validated improvement yet" is an honest result, not a fault.

The study never refills or resets the virtual account and never adds old profit to it. It runs at $0 on data the project already holds, in short capped runs, and pauses itself when the free limits run low.

## 6. One virtual account and separate records

**The experimental learner** uses the only active virtual account. Today shows its balance and Trades shows its trade history; Learn shows how it learns.

**Trade ideas** are the methods' separate research record. Their own results are never added to the account balance.

**Your journal** records your own decisions. It does not change the bot's money.

The earlier qualification account is retired. Its old record is kept for audit, and the qualification tests remain under More → Method research. Historical practice on years of older data stays separate and never adds old profit to the account.

## 7. How a method earns trust

1. **Watch.** Every 15 minutes, all futures week, the bot reads prices and posts any idea its methods spot. New ideas only start between 02:00 and 15:25 New York time (11:30–00:55 IST while the US is on summer time, 12:30–01:55 IST in winter), and everything is closed by 15:25 New York time.
2. **Test.** A method must beat thousands of random entries on years of past prices, pass a separate confirmation period, then earn 60 new trades over 20 trading days and two weekly reviews. Past replays never count as new trades.
3. **Qualification.** Passing every check records a research result. It does not start a second account or turn replay results into fresh proof. The virtual account keeps the limits listed above.

Every week the bot also tests any method marked "Not tested yet" against random entries by itself, and reports the result on Learn. It never promotes a method on its own — a person has to.

Open Learn → Method research → Weekly method screens to see recorded comparisons with random entries and with doing nothing ($0). Historical results are after modelled costs and show how many trades were tested, the price source and the dates covered. A positive historical total is not proof that a method will make money or has passed qualification.

Too little evidence is shown in amber, never red: too little data is not a loss. Red is only for a measured loss. Every rate is shown with its n, and below 30 trades it is marked "previewed, not judged".

## 8. Is the bot working?

| Word | Meaning |
|---|---|
| **Running** | Price checks are arriving every 15 minutes. |
| **Resting** | The market is closed (weekends, holidays). That is the schedule, not a fault. |
| **Prices delayed / Running late** | The feed or a check is behind. Ideas catch up on the next pass. |
| **Needs attention** | Part of a check had a problem, such as the virtual account update. Trade ideas are still checked. |
| **Last check failed** | The newest check errored. The next one runs within 15 minutes; a watchdog alerts if it keeps failing. |
| **Timer · On time** | The 15-minute timer started the latest check. |
| **Timer · Running late** | GitHub's free timer started the bot hours late. The bot catches up on prices it missed, but its decisions then come late. Fix it once, below. |
| **Timer · Waiting for GitHub** | The timer asked GitHub to start a check and GitHub has not run it yet. Usually minutes. |
| **Timer · Key refused** | GitHub refused the timer's key; it may have expired. Make a new one, below. |

The bell in the header lists anything worth a look. Its dot is amber for a warning and red only when something failed. News notes alone do not light it.

### Keep the bot on time

The bot needs a reliable timer. Since 2 November 2026 GitHub's free timer has started it only every 4 to 8 hours instead of every 15 minutes, so prices on the screens were hours old. A free timer on Neon, the app's database service, now starts it on time once you give it one GitHub key. It costs nothing and touches no real money.

1. **Make the key.** Open [GitHub's pre-filled key form](https://github.com/settings/personal-access-tokens/new?name=Aegis+engine+clock&description=Lets+the+Neon+clock+start+the+Aegis+engine+every+15+minutes&target_name=veerpatta&expires_in=366&actions=write). Under Repository access choose Only select repositories and pick aegis-futures-lab. Check that Permissions → Actions says Read and write. Click Generate token and copy it.
2. **Store it.** Open [the project's new-secret page](https://github.com/veerpatta/aegis-futures-lab/settings/secrets/actions/new) (Settings → Secrets and variables → Actions). Name it ENGINE_DISPATCH_TOKEN, paste the key and save.
3. **Start the bot once.** Open [Actions → signal-engine](https://github.com/veerpatta/aegis-futures-lab/actions/workflows/signal-engine.yml) and press Run workflow. Within 15 minutes Today's timer line reads "On time".

The key can only start or stop this project's jobs. Never paste it anywhere else. It lasts a year; when it expires the timer line turns red and you repeat the steps. To stop the timer, set the secret to "off" and run step 3.

## 9. Your journal

More → My journal is yours alone. Pick the trading day, type in a trade or import your broker's file (Tradovate and Topstep exports work), and export it any time. Entry and exit times are typed in New York time to match the chart. Sign in with an email code or your account password to keep a private copy across devices; local saving always works.

"Compare with the bot" re-runs the zone method over 60 days in your browser and shows what it did on your days. It takes a few seconds, so it only loads when you open it.

## 10. ET or IST

Times follow the ET/IST switch under More → Settings (on a computer it is also in the sidebar). Phones in India start on IST. Two things stay in New York time on purpose: trading days (a day's ideas group by the New York date) and journal entry times. Session rules print both clocks in the app.

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
| **Practice money** | The earlier qualification account, now retired. Virtual trading uses the learner's single account; the qualification tests remain available. |
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
| **Qualify** | A method earns qualification with a passed history test, a separate confirmation, 60 new trades over 20 trading days, and two weekly reviews. Delayed simulations never count as fresh proof. |
| **Probation** | The earlier qualification account used half risk ($50 per trade) for newly qualified methods. That account is now retired; the single virtual account follows its own fixed limits. |
| **Zone setup and daily flow** | The two kinds of trade ideas. Zone setups are rare returns to strong price areas. Daily flow fades short sharp moves, at most twice a day. |
| **Paused by the breaker** | When a kind of idea loses too often lately, the bot keeps simulating it but hides it from the results until it recovers. |
| **Journal** | Your own trades, typed in or imported from your broker. They stay separate from the bot and are private to you. |

## 14. If something looks wrong

- A warning with "Try again" means a read failed; the screen keeps the last good numbers.
- Prices hours old and the timer says "Running late"? GitHub's free timer is late; see Keep the bot on time in section 8.
- An idea marked "Not resolved yet" is left out of every total until the bot records its end.
- A dash (—) means there is no number yet, not zero.
- An open learner trade marked "~" or "stale" has no fresh price; its result is an estimate.
- Still stuck? Check the bell, then Learn → health. The research drawers on Ideas show every excluded row.

---

*Manual version: matches the app as of 2026-11-12 (the time machine on every bot trade and its filter test; simpler screens, AI second opinion and Ask the AI on the free NVIDIA service, DeepSeek V4.1 Flash waiting, paid AI off). If the app has changed since, the in-app Guide is the source of truth.*
