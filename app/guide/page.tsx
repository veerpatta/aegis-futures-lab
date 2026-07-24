import type { Metadata } from "next";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "How to use this app — Aegis Futures Lab",
  description:
    "A plain-English guide to the Aegis Futures Lab: what the signals mean, the daily routine, and what every page does.",
};

/* The trader's manual, in the app itself. Written for someone who knows
   trading but not software. Keep this page, docs/USER-MANUAL.md and
   docs/user-manual.pdf in sync — see CLAUDE.md. */

export default function GuidePage() {
  return (
    <div className={styles.guide}>
      <h1 className="pageTitle">How to use this app</h1>
      <p className="pageSub">
        Five minutes, no tech knowledge needed. Just trading.
      </p>

      <section className={styles.card}>
        <h2>What this app is</h2>
        <p>
          Aegis watches the two micro futures markets — <b>MES</b> (S&amp;P 500) and <b>MNQ</b>
          (Nasdaq) — and posts <b>practice trade ideas</b> two to three times a day using the
          demand-and-supply strategy this lab was built around. Every idea is tracked to its result
          (target hit, stop hit, or closed flat) so you can judge the strategy on evidence, not
          memory.
        </p>
        <div className={styles.warn}>
          <b>Nothing here touches real money.</b> There is no broker connection, prices are
          delayed 10–15 minutes, and the trade ideas come 5–15 minutes after the setup happens.
          Use it to practice, learn, and keep score — never as a live trade instruction.
        </div>
      </section>

      <section className={styles.card}>
        <h2>Your daily routine</h2>
        <ol className={styles.steps}>
          <li>
            <b>Open Home with your morning coffee.</b> It is the screen the app starts on and it
            answers the whole morning in one look: how many ideas today (the dots fill toward the
            2–3 per day target), today&apos;s profit or loss, when the bot checks next, and — at
            the top — the one idea that is live right now, with its entry, stop and target. If
            nothing is running, it says so plainly.
          </li>
          <li>
            <b>Scroll on for the last three weeks.</b> One bar per trading day, green above the
            line and red below, with the net, the win rate and the number of ideas beside it.
            Below that: the two markets, the zones price is closest to, and whether the bot is
            healthy.
          </li>
          <li>
            <b>Open Signals when you want the detail.</b> Every idea ever posted, grouped by day.
            Each row is one complete trade plan: where to get in (Entry), where the idea is wrong
            (Stop), where to take profit (Target), and how it ended (the Status badge).
          </li>
          <li>
            <b>Glance at the Zone watchlist.</b> These are the buy and sell areas the strategy
            cares about, sorted by how close price is. An amber <b>AT ZONE</b> badge means price
            is sitting in one right now — the interesting moments happen there.
          </li>
          <li>
            <b>After you trade, write it down.</b> On the Journal page, add your own trades by
            hand or import the CSV file your broker (Topstep / Tradovate) exports. The journal
            saves to the cloud automatically.
          </li>
          <li>
            <b>On the weekend, keep score.</b> The Performance panel shows the win rate and
            running profit of each tier. Give the engine a few weeks of evidence before drawing
            conclusions — a handful of trades proves nothing, in either direction.
          </li>
        </ol>
      </section>

      <section className={styles.card}>
        <h2>Tier A and Tier B — the two kinds of ideas</h2>
        <p>
          <span className={styles.tierA}>TIER A</span>&nbsp; The classic zone setup: price
          returning to a fresh daily or 4-hour demand/supply zone with everything lined up. These
          are <b>rare</b> — sometimes none for days — but they are the highest-conviction trades
          the strategy knows.
        </p>
        <p>
          <span className={styles.tierB}>TIER B</span>&nbsp; The daily bread-and-butter: a
          mean-reversion setup that fades short-term exhaustion, capped at two trades per market
          per day and shut off after two losses. These keep the feed active every day.
        </p>
        <p className={styles.note}>
          The whole point of the labels: over time, watch <b>which tier actually makes money</b>{" "}
          in the Performance panel, and weight your attention accordingly.
        </p>
      </section>

      <section className={styles.card}>
        <h2>How to read one signal</h2>
        <dl className={styles.dl}>
          <dt>Entry / Stop / Target</dt>
          <dd>
            The full plan. Risk is the distance from entry to stop; reward is entry to target.
          </dd>
          <dt>R:R</dt>
          <dd>
            Reward-to-risk. 1.5 means the target pays 1.5× what the stop costs. At 1.5 R:R you
            only need to win about 4 trades in 10 to come out ahead.
          </dd>
          <dt>Status</dt>
          <dd>
            <b>TARGET</b> = winner. <b>STOP</b> = loser. <b>OPEN</b> = still running.{" "}
            <b>FLAT CLOSE</b> = closed at 15:25 ET (00:55 IST in summer, 01:55 in winter)
            because the strategy never holds overnight.
          </dd>
          <dt>P&amp;L</dt>
          <dd>
            Simulated dollars for the position size the engine chose (risking about $160 a trade),
            with commissions already subtracted.
          </dd>
          <dt>Regime</dt>
          <dd>
            What kind of market the idea was born into: trending or ranging, quiet or volatile
            (e.g. <b>TR·HV</b> = trending, high volatility). It never changes the ideas — it is a
            label, so the Performance panel can show which conditions the strategy actually earns
            in.
          </dd>
          <dt>Marginal / doubtful fill</dt>
          <dd>
            An honesty check on the entry itself. The simulation assumes a resting order fills the
            moment price touches the entry level — in a real market a touch is often not enough.
            No chip means price traded cleanly through the level. <b>MARGINAL FILL</b> (amber)
            means price barely reached it but came back later; <b>DOUBTFUL FILL</b> (red) means
            price only kissed the level once — a real order likely never filled, so treat that
            idea&apos;s profit as imaginary. Every performance number is also restated
            &ldquo;excluding doubtful fills&rdquo; so you can see both versions.
          </dd>
        </dl>
      </section>

      <section className={styles.card}>
        <h2>What each page does</h2>
        <dl className={styles.dl}>
          <dt>Home</dt>
          <dd>
            The screen the app opens on. Today at a glance: the live idea, today&apos;s score, the
            last three weeks, the two markets, the nearest zones, and whether the bot is healthy.
          </dd>
          <dt>Signals</dt>
          <dd>Every idea, grouped by day, with the full zone watchlist and engine detail.</dd>
          <dt>Markets</dt>
          <dd>
            Delayed charts, live strategy readout, and the news calendar — each week&apos;s
            high-impact U.S. events from a free live feed, backed by the official BLS and Fed
            schedules when the feed is down.
          </dd>
          <dt>Journal</dt>
          <dd>
            Pick any past day: see what the engine did, minute by minute, next to your own
            journaled trades. This is where the learning happens.
          </dd>
          <dt>Strategy Lab (plus Compare and Data)</dt>
          <dd>
            The workshop (advanced, optional). Change strategy settings, run backtests, compare
            variants, load your own CSV history. Compare and Data sit under <b>More</b> in the
            side menu on a computer. The Data page also shows the app&apos;s own price archive —
            it saves its five-minute history to the cloud every day, so over time backtests can
            reach further back than the feed&apos;s 60-day limit — and the <b>Shadow lab</b>:
            four extra strategies auditioning silently on live data. Shadow results are{" "}
            <b>not signals</b> and never send alerts; a stream only earns promotion interest
            after at least 60 finished trades, a profit factor of 1.2 or better, and profits in
            two different market regimes. You never need any of these pages to follow the
            signals.
          </dd>
          <dt>What the bot knows</dt>
          <dd>
            Under <b>More</b> in the side menu. Every night the bot re-reads everything it has
            recorded and re-derives its own statistics — whether the zone score actually predicts
            winners, which market conditions each tier does well in, what the filters are turning
            away, whether the fills still look believable, and how the shadow strategies are doing.
            It is pure observation: nothing on this page is a trade idea and none of it changes what
            the bot does. Anything with too few finished trades to judge reads &ldquo;collecting
            (n=X of 10)&rdquo; — the bot will not draw a lesson from a handful of trades.
          </dd>
        </dl>
      </section>

      <section className={styles.card}>
        <h2>When the bot benches a strategy</h2>
        <p>
          The bot watches how each stream is actually doing. When a stream&apos;s recent results
          slump — its profit factor drops below 0.8 over its last 20 finished trades — the bot{" "}
          <b>benches it</b>: it stops showing that stream&apos;s ideas and stops counting them in
          the headline numbers, but it keeps simulating them silently in the background. When the
          silent practice run recovers — profit factor back to 1.1 or better over the next 15 — the
          bot puts the stream back in the game on its own. It waits at least three trading days
          between changes so it never flip-flops.
        </p>
        <p className={styles.note}>
          Paused streams show up in their own <b>Paused streams</b> box on the Signals page and a
          note on Home, with the date they were benched and how their practice run is recovering.
          The weekly digest keeps their practice out of the headline numbers too and reports it on
          its own line. Every bench and every return is recorded and sent to Telegram, so nothing
          happens silently. It is the safest kind of automation — learning when <i>not</i> to trade — and,
          like everything here, it is paper only.
        </p>
      </section>

      <section className={styles.card}>
        <h2>The model that learns to skip weak signals</h2>
        <p>
          Alongside the strategies, a small model studies every signal the bot has already seen and
          learns which setups are <b>least</b> likely to win. It can only ever do one thing: quietly
          skip the weakest 1-in-10 signals. It can never invent a trade or make one bigger.
        </p>
        <p>
          It has to <b>earn the right</b> to act. Until it has at least 300 clean examples <i>and</i>{" "}
          its predictions beat a simple baseline on data it has never seen, it only shadow-votes —
          it marks which signals it <i>would</i> have skipped, and the Saturday digest reports how
          those would have done, so you can watch it audition just like the shadow strategies. If it
          graduates and later starts slipping, it demotes itself back to watching. You can see its
          status, accuracy trend and calibration on the <b>What the bot knows</b> page, and it is
          paper only, like everything here.
        </p>
      </section>

      <section className={styles.card}>
        <h2>The bot proposes its own upgrades</h2>
        <p>
          Once a week the bot searches for better strategy settings and tests them the honest way:
          it tunes on older data, checks the result on a month it never saw, and stress-tests the
          worst-case drawdown. If the same improved setting wins two weeks in a row — or a shadow
          strategy passes its promotion checklist two weeks running — the bot opens a{" "}
          <b>pull request</b> on GitHub with the full evidence attached.
        </p>
        <p className={styles.note}>
          A pull request is just a proposal. <b>Nothing changes until you merge it</b> — the bot can
          never edit the live settings by itself, and it will not pester you with the same idea more
          than once a month. Most weeks it finds nothing and stays quiet, which is exactly what a
          disciplined system should do. Merging is the one job left to you; everything else —
          noticing, measuring, proposing — is the bot&apos;s.
        </p>
      </section>

      <section className={styles.card}>
        <h2>ET or IST — your choice</h2>
        <p>
          Every time in the app can be shown on the New York exchange clock (<b>ET</b>) or on
          your own clock in India (<b>IST</b>). Use the <b>ET / IST</b> switch — bottom of the
          side menu on a computer, top right on a phone. Your choice is remembered on that
          device, and it changes every screen at once: the signal times, the chart&apos;s time
          axis, the journal, the news calendar.
        </p>
        <p>
          Two things deliberately do <b>not</b> move:
        </p>
        <ul className={styles.steps}>
          <li>
            <b>Trading days.</b> The blotter groups ideas by New York trading day, always. An
            idea posted at 21:20 IST belongs to that New York session, not to the next Indian
            date.
          </li>
          <li>
            <b>Journal entry times.</b> You type your own trades in ET, because that is what the
            chart and the engine&apos;s own timestamps use. When the app is set to IST, the form
            shows you what your typed ET time means in IST as you go.
          </li>
        </ul>
        <p className={styles.note}>
          India does not change its clocks but the United States does, so the gap is 9½ hours
          from March to November and 10½ hours through the winter. The app works this out for
          you — the session rules always print both, like &ldquo;flat by 15:25 ET (00:55
          IST)&rdquo;, and that second figure shifts by itself when New York changes its clocks.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Put it on your phone</h2>
        <p>
          Open this site on your phone, then choose <b>Add to Home Screen</b> (in the browser
          menu). It installs like an app and opens straight onto the Home screen, with the five
          main pages along the bottom.
        </p>
      </section>

      <section className={styles.card}>
        <h2>&ldquo;Live vs tuning window&rdquo; — is it still working?</h2>
        <p>
          The strategy&apos;s settings were chosen on past data, which promised a certain profit
          factor and pace for each stream. This Home panel compares that promise with what the
          live ideas have actually delivered since go-live. While a stream has fewer than 20
          finished ideas it only says <b>collecting data</b> — a handful of trades proves nothing.
          After that: green <b>tracking</b> means reality matches the promise, amber{" "}
          <b>lagging</b> means it is earning less than promised but still above water, and red{" "}
          <b>underwater</b> means the stream is losing money over a meaningful sample.
        </p>
        <p className={styles.note}>
          A red stream means <b>stop trusting that stream</b> — the market may have changed since
          the settings were tuned. It never means &ldquo;trade harder to catch up&rdquo;. The
          muted line under each stream repeats the numbers excluding doubtful fills, the stricter
          honest version.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Telegram alerts (optional)</h2>
        <p>
          The bot can message you on Telegram the moment an idea triggers — entry, stop, target
          and reward-to-risk, with the time in both ET and IST — and again when it closes with the
          result. These are <b>paper ideas, not orders</b>: same delayed data, same simulation as
          the app, just delivered to your phone. It also messages if an engine run fails, so a
          quiet feed means a healthy bot, not a broken one. (Set up once by the operator with a
          free Telegram bot; nothing to configure in the app.)
        </p>
      </section>

      <section className={styles.card}>
        <h2>Words you&apos;ll see</h2>
        <dl className={styles.dl}>
          <dt>Zone</dt>
          <dd>
            A price area where big buying (demand) or selling (supply) showed up before. The
            strategy trades the return to these areas.
          </dd>
          <dt>Fresh / Tested</dt>
          <dd>
            Fresh = price hasn&apos;t come back to the zone yet (strongest). Tested = it has been
            touched once already.
          </dd>
          <dt>Paper trading</dt>
          <dd>Practice trades with imaginary money. All trades in this app are paper trades.</dd>
          <dt>Flat by 15:25 ET (00:55 IST)</dt>
          <dd>
            The strategy closes everything before the New York session ends. No overnight risk,
            ever.
          </dd>
          <dt>Engine</dt>
          <dd>
            The automated checker (the &ldquo;bot&rdquo;) that re-reads the market every 15
            minutes during London and New York hours and posts what it finds. If Home or Signals
            says the bot is idle or a run failed, the feed is paused — not the market. An amber
            &ldquo;data delayed more than usual&rdquo; note means the bot is running but the
            prices it last saw are older than the usual 10–15 minutes — ideas catch up on the
            next pass. On CME holidays the app simply shows &ldquo;Market closed&rdquo; with the
            holiday&apos;s name — the bot rests on purpose — and on half days (like the day
            after Thanksgiving) everything closes and flattens early.
          </dd>
        </dl>
      </section>

      <p className={styles.foot}>
        Matches the app as of 2026-07-24. A printable version of this guide lives in the project
        as{" "}
        <a
          href="https://github.com/veerpatta/aegis-futures-lab/blob/main/docs/user-manual.pdf"
          target="_blank"
          rel="noreferrer"
        >
          docs/user-manual.pdf
        </a>
        .
      </p>
    </div>
  );
}
