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
            <b>Open Signals with your morning coffee.</b> The strip at the top tells you three
            things at a glance: is the market open, when does the engine check next, and how many
            ideas it has posted today (the three dots fill toward the 2–3 per day target).
          </li>
          <li>
            <b>Read today&apos;s ideas in the blotter.</b> Each row is one complete trade plan:
            where to get in (Entry), where the idea is wrong (Stop), where to take profit
            (Target), and how it ended (the Status badge).
          </li>
          <li>
            <b>Glance at the Zone watchlist.</b> These are the buy and sell areas the strategy
            cares about, sorted by how close price is. An amber <b>AT ZONE</b> badge means price
            is sitting in one right now — the interesting moments happen there.
          </li>
          <li>
            <b>After you trade, write it down.</b> On the Replay page, add your own trades by hand
            or import the CSV file your broker (Topstep / Tradovate) exports. The journal saves to
            the cloud automatically.
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
            <b>FLAT CLOSE</b> = closed at 15:25 ET because the strategy never holds overnight.
          </dd>
          <dt>P&amp;L</dt>
          <dd>
            Simulated dollars for the position size the engine chose (risking about $160 a trade),
            with commissions already subtracted.
          </dd>
        </dl>
      </section>

      <section className={styles.card}>
        <h2>What each page does</h2>
        <dl className={styles.dl}>
          <dt>Signals</dt>
          <dd>The daily feed. If you only use one page, use this one.</dd>
          <dt>Replay</dt>
          <dd>
            Pick any past day: see what the engine did, minute by minute, next to your own
            journaled trades. This is where the learning happens.
          </dd>
          <dt>Markets</dt>
          <dd>Delayed charts, live strategy readout, and the news calendar.</dd>
          <dt>Lab, Compare, Data</dt>
          <dd>
            The workshop (advanced, optional). Change strategy settings, run backtests, compare
            variants. You never need these to follow the signals.
          </dd>
        </dl>
      </section>

      <section className={styles.card}>
        <h2>Put it on your phone</h2>
        <p>
          Open this site on your phone, then choose <b>Add to Home Screen</b> (in the browser
          menu). It installs like an app and opens straight onto the signal feed.
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
          <dt>Flat by 15:25 ET</dt>
          <dd>
            The strategy closes everything before the New York session ends. No overnight risk,
            ever.
          </dd>
          <dt>Engine</dt>
          <dd>
            The automated checker that re-reads the market every 15 minutes during London and New
            York hours and posts what it finds. If the Signals page says the engine is stale or
            failed, the feed is paused — not the market.
          </dd>
        </dl>
      </section>

      <p className={styles.foot}>
        A printable version of this guide lives in the project as{" "}
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
