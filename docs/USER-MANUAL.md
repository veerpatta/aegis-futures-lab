# Aegis Futures Lab — User Manual

*For traders, not technicians. Everything you need to use the app, in plain language.*

Live app: https://aegis-futures-lab-khaki.vercel.app
This manual is also available inside the app on the **Guide** page.

---

## 1. What this app is

Aegis watches micro index futures and keeps an evidence-first record of simulated
strategies. When an eligible paper stream is active it posts **practice trade ideas** and
tracks every result. When the evidence benches those streams, Home says **RESEARCH MODE**
instead of quietly substituting an untested strategy. The point is to judge every idea on
evidence instead of memory.

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
6. **On the weekend, keep score.** The Performance panel shows the expectancy per trade,
   the win rate and the running profit of each tier — each with the number of trades
   behind it. Give the engine a few weeks of evidence before drawing conclusions:
   anything still marked "previewed, not judged" proves nothing, in either direction.

## 2a. How to read a number here

Every percentage and profit factor in this app comes with two extra pieces of
information, and they matter more than the number itself.

- **n = how many trades it is based on.** You will see **n=7** or **n=26** under every
  rate. That is the number of finished trades the figure was calculated from. A win rate
  on seven trades and a win rate on seven hundred look identical on screen unless the app
  tells you which is which, so it always tells you.
- **The range in brackets.** A win rate of **67%** sounds like an edge. On three trades,
  the honest range around it is **21% to 94%** — which is another way of saying you have
  learned nothing yet. That bracketed range is what the true rate could plausibly be,
  given how few trades there are. It narrows as trades accumulate. When it is wide,
  ignore the headline number.
- **"previewed, not judged".** Below **30 finished trades** a figure is greyed and carries
  this amber tag. It is shown so you can watch it develop — not so you can act on it.
  Above 30 the tag disappears. Nothing about a tagged number is broken; there simply is
  not enough of it yet.
- **"nothing logged yet".** Zero finished trades. This is *not* a zero percent win rate
  and does not mean anything failed — it means the stream has not traded yet. Tier A can
  sit here for weeks, which is normal for it.
- **Expectancy comes first.** Where you used to see win rate as the headline you will now
  see **expectancy per trade** — the average profit or loss across every trade, winners
  and losers together. It is the figure that answers "is this making money?". Win rate on
  its own cannot: winning 70% of the time while losing far more on the losers than you
  make on the winners still empties the account. Win rate is still shown, just
  underneath, where it belongs.

None of this is a disclaimer. Reading a small sample as if it were a large one is the most
expensive mistake available to a trader with a dashboard, and the app is built to make it
hard.

## 2b. The clean streak — the one number about you

Home used to show a **green streak**: how many days in a row finished in profit. That
rewarded the wrong thing. A day where you broke every rule and got away with it kept
the streak; a day where you followed your plan exactly and lost broke it. In an app
built on the idea that process beats outcome, that was backwards.

It is now a **clean streak**: days in a row where *you broke no rule*. It is judged
from your journal against the same rules the bot follows — entries only inside the
trading window, no more than two trades a day per market, stop after two losers, and
nothing wildly oversized.

- **A losing day where you followed the plan keeps the chain alive.** That is the
  whole point.
- **A winning day where you broke a rule ends it.** Getting away with it is not the
  same as being right.
- With an empty journal it reads **"log a trade to start the chain"** — not a zero-day
  streak, which would look like a failure you have not had.

Don't break the chain. It is the only score on the app entirely within your control.

## 2c. Your costs are now counted

Your journalled trades used to be shown **gross** — before commission — while the
bot's figures were always **net**. Every close race quietly favoured you. Both sides
now have the same $2.40 per contract taken out, so "bot vs you" is a fair fight.

One difference remains, and it runs against the bot. The bot also pays a tick of
slippage on the way in, because its fills are simulated and it assumes it does not
always get the price it wanted. Your entry price is the fill you actually got, so your
slippage is already in the number — charging you a second helping would count it twice.
All in, the bot carries about $3.65 a contract on MES and $2.90 on MNQ against your
$2.40.

One consequence worth knowing: a trade that made a tick or two is now correctly shown
as a small *loss*, because the commission was bigger than the move. That is real, and
it is what your broker statement says too.

## 2d. How far a trade ran before it ended

Every finished trade now records the worst it got against you and the best it got in
your favour, measured in **R** — multiples of the distance from your entry to your stop.

- **Worst drawdown (MAE)** — how far offside the trade went before it worked out. Look
  at this on your *winners*: if they routinely go 0.8R against you first, a tighter
  stop would have cut them all.
- **Best run (MFE)** — how far onside it went before it ended. Look at this on your
  *losers*: if they were usually green first, a break-even rule would have paid for
  itself.
- **How much you kept** — what you actually took out of the move, against the best it
  ever showed. Low numbers mean you are exiting well before the trade is done, or
  holding well past it.

## 2e. Zones on the chart

On Markets, buy and sell areas are drawn as **shaded rectangles** rather than single
lines. The **solid edge** is where price enters the zone — the line you would get
filled at. The **dashed edge** is the far side; your stop belongs just beyond it.
Green is a buy area, red is a sell area, and a faded box is one price has already
worked through.

A single line could not show the difference between price touching the edge of a zone
and eating all the way through it — which is exactly the difference between a trade
and no trade.

## 2f. The Review page — when the money is made

The weekend page. A calendar of every trading day coloured by profit or loss, a
year-at-a-glance heatmap, and the same results split by **session** (London, NY open,
lunch, NY close), weekday, market and market conditions.

Use it to find *when* the money is made and when it is given back. Every split carries
its own sample size, and they are all small — read those before the percentages. A
session showing "0% win rate" on three trades is not a broken session; it is three
trades.

## 3. Tier A and Tier B — the two kinds of ideas

- **TIER A** — the classic zone setup: price returning to a fresh Daily or 4-hour
  demand/supply zone with everything lined up. These are **rare** (sometimes none for
  days). The label describes selectivity, not proof of edge; Diagnostics records the
  measured verdict.
- **TIER B** — a mean-reversion setup that fades short-term exhaustion, capped at two
  trades per market per day and shut off after two losses. A breaker can bench it when
  recent paper results deteriorate, so an empty feed can be the correct safety state.

The point of the labels: over time, watch **which tier actually makes money** in the
Performance panel, and weight your attention accordingly.

### Ideas in the Lab that are not traded

The Strategy Lab lists more ideas than the bot actually runs. Their cards carry a tag, and
there are two of them:

- **UNMEASURED**, in amber. The idea has never been tested against random entries, so
  nobody knows yet whether it is better than a coin flip. An unmeasured idea is **not** a
  losing idea — it is an untested one, which is why the tag is amber rather than red.
- **REFUTED**, in red. The idea *has* been tested, and it did not beat random entries.

You can open any of them in the Lab and backtest them like anything else. What they will
never do is produce a signal on Home or Signals, or place a paper trade. Nothing reaches
the live feed until it has beaten random entries on years of data.

**Gold zones, silver confirmed** is the newest of these, and as of 21 August 2026 it is
**refuted**. It buys gold demand zones and sells gold supply zones, but it waits for
silver to arrive at its matching zone first — the idea being that a move both metals agree
on is worth more than a move only one of them makes.

It was tested over seven years of gold data, one year at a time. It did not beat random
entries in a single one of those years. Its results sit in the middle of what you would
get by opening trades at random times, which is the plainest way of saying the rule is not
telling you anything.

Worth being precise about what that does and does not mean. Gold and silver really do move
together — that part was checked first and held up. What failed is the next step: knowing
that silver has arrived at its zone does not tell you where gold goes next. And it is not
losing because of costs. Switch the costs off and it still loses.

Two more things to know:

- **Silver is watched, never traded.** The app cannot take a position in silver at all. If
  you run this in the Lab you will see silver on the instrument line with zero trades next
  to it, and that is correct rather than a fault.
- **It is not live and will not be tuned.** A setup that does not beat a coin flip does not
  get adjusted until it looks better on the same data that just refuted it. That is how you
  fool yourself, and this app has a rule against it.

### When the bot benches a strategy (circuit breakers)

The bot watches how each stream is doing. When a stream's recent results slump — profit
factor below 0.8 over its last 20 finished trades — it **benches** that stream: it stops
showing its ideas and stops counting them in the headline numbers, but keeps simulating
them silently. When the silent practice recovers (profit factor 1.1 or better over the
next 15), the bot returns the stream to the game on its own, waiting at least three
trading days between changes so it never flip-flops. Paused streams appear in their own
**Paused streams** box on Signals and a **RESEARCH MODE** note on Home; the weekly digest also keeps their
practice out of the headline numbers and reports it on its own line. Every bench and return
is recorded and sent to Telegram. It is the safest kind of automation — learning when *not*
to trade — and it is paper only.

Research mode means exactly what it says: no unmeasured candidate is presented as the
replacement while its benchmark is unfinished.

### What each idea tells you at a glance

Every idea on Home and on Signals carries four lines under it, so you do not have to hold the
context in your head:

- **Setup** — what triggered it, in the strategy's own terms.
- **Invalidated** — the price that proves the idea wrong, and how far away it is. This is the
  stop: if price gets there, the reason for the trade is gone.
- **Odds** — the model's win probability for this idea, plus the zone score where there is one.
  If the model has not scored it, it says so rather than showing a number.
- **History** — how *this kind of setup* has actually done: the same tier in the same kind of
  market, and the same tier at the same level of market fear. **Every one of these comes with
  the number of trades behind it**. Below 10 trades it says "still collecting" and shows no
  rate at all; between 10 and 30 it shows the numbers but marks them "previewed, not judged".
  A 100% win rate on 3 trades is not information, and the app will not present it as if it
  were.

### When nothing happens: "Why no signal today?"

A quiet day raises exactly one question — is the bot broken, or just being patient? The
**Why no signal today?** box on Home answers it in a sentence, using the bot's own count of
what it looked at: how many five-minute candles it checked, how many zones price actually
reached, how many setups qualified, and what stopped the rest.

A big number of candles checked with nothing qualified is the **normal, healthy** state —
this strategy is built to wait for price to come to it. The box also tells you when something
else is going on: a strategy benched by the breaker, or a stalled price feed. If it cannot
tell you why, it says so rather than guessing.

### The model that learns to skip weak signals

A small model studies every signal the bot has seen and learns which setups are **least**
likely to win. It can only ever do one thing: quietly skip the weakest 1-in-10 signals — it
can never invent or enlarge a trade. It must **earn the right** to act: until it has at least
150 clean examples *and* beats a simple baseline on unseen data *two nights running*, it only
shadow-votes (marking what it *would* have skipped, with the Saturday digest reporting how
those would have done). The count it has and the count it needs are printed together
everywhere it appears. If it graduates and later slips, it demotes itself. Its status,
accuracy trend and calibration are on the **What the bot knows** page. Paper only.

### The bot proposes its own upgrades

Once a week the bot searches for better strategy settings and tests them honestly — tuning on
older data, checking on a held-out month it never saw, and stress-testing the worst-case
drawdown. If the same improvement wins two weeks running (or a shadow strategy passes its
promotion checklist two weeks running), it opens a **pull request** on GitHub with the
evidence attached. A pull request is only a proposal: **nothing changes until you merge it**,
the bot can never edit live settings itself, and it will not re-propose the same idea for a
month. Most weeks it finds nothing and stays quiet. Merging is the one job left to you.

## 4. How to read one signal

| Field | Meaning |
|---|---|
| Entry / Stop / Target | The full plan. Risk = entry to stop; reward = entry to target. |
| R:R | Reward-to-risk. 1.5 means the target pays 1.5× what the stop costs — you only need to win about 4 in 10 to come out ahead. |
| Status | **TARGET** = winner · **STOP** = loser · **OPEN** = still running · **CLOSED UP** = finished in profit without reaching a target (some strategies exit on their own signal rather than a fixed target; those wins used to be mislabelled as flat closes) · **FLAT CLOSE** = closed at 15:25 ET / 00:55 IST with nothing gained (the strategy never holds overnight). |
| P&L | Simulated dollars for the position size the engine chose (risking about $160 per trade), commissions already subtracted. |
| Regime | What kind of market the idea was born into: trending or ranging, quiet or volatile (e.g. **TR·HV** = trending, high volatility). It never changes the ideas — it is a label, so the Performance panel can show which conditions the strategy actually earns in. |
| Stale data | The feed is delayed 10–15 minutes by design, but sometimes it stalls for far longer. If the newest bar is more than **30 minutes** old when the bot runs, any idea it works out describes a market that has already moved on. Those ideas are still recorded — hiding them would hide the outage — but they are marked **STALE DATA**, kept out of every score, never sent to Telegram, and never used to teach the model. They appear in their own **Excluded: stale data** box on Signals. |
| Revised-away signal | The data vendor corrected a bar inside the seven-day reconciliation window and the deterministic rerun no longer produced the older row. It is kept for traceability, marked **REVISED**, removed from performance, breakers, alerts and model training, and shown in **Excluded: revised-away signals** on Signals. |
| Marginal / doubtful fill | An honesty check on the entry. The simulation assumes a resting order fills when price touches the entry level — in a real market a touch is often not enough. No chip = price traded cleanly through the level. **MARGINAL FILL** (amber) = price barely reached it but came back later. **DOUBTFUL FILL** (red) = price only kissed the level once; a real order likely never filled, so treat that idea's profit as imaginary. Every performance number is also restated "excluding doubtful fills". |

## 5. What each page does

| Page | What it's for |
|---|---|
| **Home** | The screen the app opens on. Today at a glance: the live idea, today's score, the last three weeks, the two markets, the nearest zones, **why there was no signal today**, and whether the bot is healthy. |
| **Signals** | Every idea, grouped by day, with the full zone watchlist and engine detail. |
| **Markets** | Delayed charts, a live strategy readout, and the news calendar — each week's high-impact U.S. events from a free live feed, backed by the official BLS and Fed schedules when the feed is down. The readout loads the selected strategy's actual instruments, including gold and its silver confirmation feed, rather than substituting MES and MNQ. |
| **Journal** | Pick any past day: see what the engine did, minute by minute, next to your own journaled trades. This is where the learning happens. |
| **Strategy Lab** | The workshop (advanced, optional). Change strategy settings and run backtests. |
| **Compare / Data** | More of the workshop — compare variants, load your own CSV history. Both sit under **More** in the side menu on a computer. The Data page also shows the app's own price archive (its five-minute history saved to the cloud daily, growing past the feed's 60-day limit) and the **Shadow lab**: four extra strategies auditioning silently on live data. Shadow results are **not signals** and never alert; a stream earns promotion interest only after ≥60 finished trades, PF ≥ 1.2, and profits in two different market regimes. |
| **What the bot knows** | Under **More** in the side menu. Every night the bot re-reads everything it has recorded and re-derives its own statistics — whether the zone score predicts winners, which market conditions each tier does well in, what the filters turn away, whether the fills still look believable, and how the shadow strategies are doing. Pure observation: nothing here is a trade idea and none of it changes what the bot does. Anything with too few finished trades reads "collecting (n=X of 10)". |
| **Diagnostics** | Under **More** in the side menu. The hardest question in the app: **is the entry actually doing anything?** It re-runs every stream a thousand times with the entries replaced by coin flips — same stops, same targets, same costs, same number of trades, same times of day, same long/short balance — and shows where the real result lands among those thousand random versions. If the real strategy is not in the top 5% of them, the entry rule is not adding anything and changing its settings will not help. Every result appears twice: **gross** (before costs) beside **net** (after), so you can see how much of a loss is the idea and how much is commission and spread. Lower down: **where the drift actually is** (how much of the market's move happens overnight while the bot is flat, versus during the day when it can trade), the **promotion gate** shown turning down all three of the bot's own live ideas, and a **hypothesis board** of new ideas being tested the same way. Nothing on the board is a signal — a new idea starts with no more standing than the old ones ended with. |
| **Guide** | The in-app version of this manual. |

You never need the workshop pages to follow the signals.

### Finding your way around the screen

Every page has the same bar across the top: the diamond mark and the page name on the left,
and three controls on the right.

| Control | What it does |
|---|---|
| **ET / IST** | Which clock every time on screen is shown in. See section 6. |
| **The eye — private mode** | Turns every money figure into dots, so you can check the app on a train without showing your P&L to the next seat. Prices, times, win rates and status labels stay, because those are what make the screen readable. Remembered on that device. Backtest results in the Strategy Lab are *not* hidden — they are hypothetical numbers from a simulation, not your money. |
| **The bell — what needs attention** | A red dot appears when there is something real to report: the bot has not checked in recently, the last check failed, the price feed is running late, a stream has been benched, or a news pause is coming. Tap for the list. No dot means there is nothing to say. |

On Home, the line under the bar tells you when the bot last checked and lets you tap to check
again. The big number below it is your P&L, and the **Today / Week / 3 wks** switch changes the
window it covers — the small badge beside it is the profit factor for that same window, and the
line underneath is the running total after each closed idea.

When an idea is open, the coloured track shows where price is sitting between your stop (left,
red) and your target (right, green), with a tick for the entry. It is the one thing worth a
glance mid-trade. Underneath it, the twelve small bars are the bot's last twelve scheduled
checks — taller means the check took longer, green means it finished cleanly — and the green
streak counts how many trading days in a row have finished up.

**Tapping any idea** — on Home, on Signals, or from a day in the Journal — slides up a card with
its entry, stop, target and a plain-English "why the bot took it". Tap outside the card, or press
Escape, to go back without losing your place on the page. On Signals, the **Live / Zones /
History** switch at the top shows what is working now, which zones price is walking into, and what
has already closed; the ring on each card is the model's win probability, and it reads "—" when
the model has not scored that idea.

On Markets, the top card is whichever contract you are looking at: its price, its move on the
day, and a chart with a dashed blue line at yesterday's close so you can see at a glance whether
the day is up or down. The five pills under it change the bar size — 5m through 1D — and
**Line / Candles** switches between the quick shape and the full candlestick chart. The other
contract sits in a row further down; tap it to bring it into the top card.

In the Journal, the coloured grid is three weeks of daily P&L — one square per trading day,
showing the date and that day's result, pattern first and numbers second. Hover or long-press a
square for the exact figure, or tap it to load that day. **Bot vs you** compares the engine
against your own logged trades over the days you actually journaled. Your side is gross of costs and the engine's already has commission and slippage taken
out, so a close race is really a win for the bot. In the Strategy Lab, the front panel holds only
the settings that genuinely change behaviour, in plain words, with everything else in
**Advanced**.

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

## 7a. "Live vs tuning window" — is it still working?

The strategy's settings were chosen on past data, which promised a certain profit factor
and pace for each stream. The Home panel **Live vs tuning window** compares that promise
with what the live ideas have actually delivered since go-live. While a stream has fewer
than 20 finished ideas it only says **collecting data** — a handful of trades proves
nothing. After that: green **tracking** = reality matches the promise; amber **lagging** =
earning less than promised but still above water; red **underwater** = the stream is
losing money over a meaningful sample. Red **refuted** overrides all of them and is
explained in 7b.

Some streams say **this stream clusters**. That matters: their trades do not arrive at a
steady rate, they come in bursts, so the "per day" figure is a long-run average and not a
pace to expect. **Zone setups** is one of these — measured over eleven weeks it traded on
only 3 days in 51, and most of those trades were on a single day. Whole quiet weeks from
that stream are normal and are *not* a shortfall.

A red stream means **stop trusting that stream** — the market may have changed since the
settings were tuned. It never means "trade harder to catch up". The muted line under each
stream repeats the numbers excluding doubtful fills, the stricter honest version.

## 7b. "Refuted" — what it means, and why every stream now says it

There is a fifth state, and as of 31 July 2026 **all three streams are in it**. Read this
before you read any other number in this app.

The settings were chosen on **sixty days** of a delayed, free price feed. That is where the
"tuned profit factor" figures came from. We have since loaded **seven years of real
exchange data** for the actual MES and MNQ contracts — about a million candles — and re-run
the exact same settings over it:

| Stream | Trades | Profit factor | Net |
|---|---|---|---|
| Zone setups (tier A) | 1,180 over 1,838 days | **0.55** | **−$57,065** |
| Daily flow, MES | 2,641 | **0.71** | **−$68,001** |
| Daily flow, MNQ | 2,731 | **0.87** | **−$28,773** |

A profit factor below 1.0 means the losses were bigger than the wins.

Read the profit factor, not the dollar figure. Those totals assume a constant
$160 of risk on every trade for seven years and ignore the account being wiped
out along the way — the worst drawdown alone is $69,711 against a $3,000
starting balance. They are the size of the leak, not a bill anyone could have
paid.

And it is not one bad patch. Breaking the two daily-flow streams down year by year gives
sixteen figures — two markets × eight years, 2019 to 2026 — and **all sixteen lost money**.
Not one profitable year in either market. (Zone setups was not split by year; it trades on
only about one session in six, so a single year of it is too thin to read.)

Sixty days is roughly fifty trading sessions; seven years is roughly eighteen hundred. When
a set of settings looks good on the small sample and loses money on the large one, the
honest conclusion is that the small sample was luck, not that the market has changed. The
tuned figures are still on screen, but only as the claim that failed.

Nothing here has ever placed an order, so nothing was lost — but this is exactly the finding
the app exists to surface, and it says the current settings do not have an edge. The streams
keep running on paper so the numbers keep updating. **Do not trade these signals.**

## 7c. Telegram alerts (optional)

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
| Engine (the "bot") | The automated checker that re-reads the market every 15 minutes for the whole futures week — Sunday evening reopen through Friday's close — so zones keep refreshing overnight, even though new ideas are only ever taken between 02:00 and 15:25 ET. If Home or Signals says the bot is idle or a run failed, the feed is paused — not the market. |
| Win rate | Share of closed trades that made money. |
| Delayed data | Prices arrive 10–15 minutes late. Fine for studying, useless for live execution. |
| ET / IST | The two clocks the app can show. ET is New York exchange time — the clock the strategy is written in. |

## 9. If something looks wrong

- **"Market closed — <holiday name>"** — a CME holiday (Good Friday, Thanksgiving,
  Christmas…). The bot rests on purpose and the day shows calmly as closed, not as a
  problem. On half days (MLK day, the day after Thanksgiving, Christmas Eve…) trading
  stops early — the session bar says "early close" and simulated positions are flat
  before the earlier bell.
- **"Data delayed more than usual"** — an amber note on Home (Bot status) and on the
  Signals heartbeat. The bot is running **during trading hours**, but the prices it last
  saw are older than the usual 10–15 minutes (a slow feed or a missed check). Ideas
  simply catch up on the next pass — treat the current ones as extra-delayed. Outside
  trading hours the note never appears: there is nothing to be late for.
- **"Bot asleep" on Home / "ASLEEP" on Signals** — no check is scheduled right now. The
  bot checks every 15 minutes for as long as the futures market is open, and rests only
  when it is shut, so it is asleep from Friday evening until the Sunday evening reopen.
  The card shows when the next check is due. "Last check 1d 17h ago" alongside "asleep"
  is the schedule working, not a fault — nothing was missed.
- **"Bot idle" on Home / "Engine idle / stale" on Signals** — different, and worth a
  glance: a check WAS due and has not arrived (it runs on a free scheduler that is
  sometimes 5–15 minutes late). It catches up on the next pass; nothing is lost, because
  every pass recomputes the full picture.
- **"Nothing open right now" on Home** — normal. Most of the day there is no live idea;
  the card tells you when the bot checks next.
- **No signals today** — quiet days happen, especially for Tier A. The pace dots simply
  stay empty. That is information too.
- **"Signal feed unreachable"** — your device is offline or the database is briefly
  unavailable. The page retries every minute on its own.

---

*Manual version: matches the app as of 2026-08-25. If the app has changed since, the
Guide page in the app is the up-to-date reference (this file is regenerated from it —
see CLAUDE.md in the repository).*
