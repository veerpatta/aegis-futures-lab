import type { Metadata } from "next";
import { GLOSSARY, GLOSSARY_KEYS } from "@/lib/glossary";
import { PAPER_RISK } from "@/lib/paper/policy";
import { etTimeLabel, etWindowLabel } from "@/lib/time/zones";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "How to use this app — Aegis Futures Lab",
  description:
    "A plain-English guide to Aegis: the five tabs, how to read a trade idea, the practice money, and how the bot earns the right to trade.",
};

/* Session times print both clocks from the current US daylight-saving state
   (CLAUDE.md: never hardcode the gap), so the page re-renders daily. */
export const revalidate = 86400;

/* The trader's manual, in the app itself. Written for someone who knows
   trading but not software — or neither. Keep this page, docs/USER-MANUAL.md
   and docs/user-manual.pdf in sync (CLAUDE.md). The word list renders from
   lib/glossary.ts, the same text the tap-a-word sheets show. */

const usd = (v: number) => `$${v.toLocaleString("en-US")}`;

export default function GuidePage() {
  return (
    <div className={styles.guide}>
      <h1 className="pageTitle">How to use this app</h1>
      <p className="pageSub">Five minutes. No tech knowledge needed.</p>

      <section className={styles.card} id="start">
        <h2>Start here</h2>
        <p>
          Aegis has a bot that watches two stock-index futures — the S&amp;P micro (MES) and the Nasdaq micro (MNQ) —
          and tests trading methods on them. It shows you what it finds in plain words, and it keeps an honest score.
        </p>
        <p>
          The short version today: <b>no method has beaten chance yet</b>, so the bot is still testing and has not
          traded its practice money. The trade ideas you see are a record of what the methods do, not advice.
        </p>
        <div className={styles.warn}>
          <b>Nothing here touches real money.</b> There is no broker connection. Prices are delayed 10–15 minutes and
          trade ideas arrive 5–15 minutes after the setup. Use the app to practice, learn and keep score — never as a
          live trade instruction.
        </div>
      </section>

      <section className={styles.card}>
        <h2>The five tabs</h2>
        <dl className={styles.dl}>
          <dt>Today</dt>
          <dd>
            One sentence on whether the bot is working and trading, the two markets, the practice money, the latest
            trade ideas and any big news coming up.
          </dd>
          <dt>Ideas</dt>
          <dd>
            Every trade idea, open or finished. The verdict on the methods sits at the top. &ldquo;For
            researchers&rdquo; at the bottom holds every number behind the cards.
          </dd>
          <dt>Chart</dt>
          <dd>
            Prices, the price areas the bot watches, why there is no idea right now, and the big news it steps aside
            for.
          </dd>
          <dt>Bot</dt>
          <dd>Where the bot is on its Watch → Test → Practice path, its health, the practice money and each method&apos;s progress.</dd>
          <dt>More</dt>
          <dd>Your Journal and Review, this Guide, settings (ET or IST, hide money) and the research room.</dd>
        </dl>
        <p className={styles.note}>
          Any word with a dotted underline can be tapped for a short meaning. Close a sheet with its ✕ or Escape.
        </p>
      </section>

      <section className={styles.card}>
        <h2>How to read a trade idea</h2>
        <ol className={styles.steps}>
          <li>
            <b>Buy or Sell, and which market.</b> &ldquo;Sell · Nasdaq micro&rdquo; means the idea expected the Nasdaq
            micro to fall.
          </li>
          <li>
            <b>The badge.</b> A red &ldquo;Method hasn&apos;t beaten chance&rdquo; means the method behind it was tested
            on years of prices and did no better than random entries. Amber &ldquo;Not tested yet&rdquo; means nobody
            has checked.
          </li>
          <li>
            <b>The bar.</b> Stop on the left, target on the right, the white tick is the entry. The red part is the
            room to be wrong; the green part is how far it aimed. A ring shows where it ended.
          </li>
          <li>
            <b>The sentence.</b> &ldquo;Exits at X if wrong (−$Y per contract) or Z if right (+$W)&rdquo; turns the
            prices into dollars for one contract. MES moves $5 a point, MNQ $2 a point.
          </li>
          <li>
            <b>The ending.</b> Reached its target, Stopped out, Closed before stop or target, Open now — or &ldquo;Not
            resolved yet&rdquo; when the bot has not recorded how an old idea finished. Results are after costs.
          </li>
          <li>
            <b>Details.</b> Tap a card for why the bot took it and, under &ldquo;How this kind of idea has
            done&rdquo;, the numbers with their sample sizes.
          </li>
        </ol>
      </section>

      <section className={styles.card}>
        <h2>Two kinds of money — never mixed</h2>
        <p>
          <b>Trade ideas</b> are a simulated record: what each method would have done, followed to the end on delayed
          prices. Their results show on Today, Ideas and Review.
        </p>
        <p>
          <b>Practice money</b> is the bot&apos;s own {usd(PAPER_RISK.capital)} paper account. It only trades once a
          method has passed every test, so it has not traded yet. It shows on Today and Bot.
        </p>
      </section>

      <section className={styles.card}>
        <h2>How the bot earns the right to trade</h2>
        <ol className={styles.steps}>
          <li>
            <b>Watch.</b> Every 15 minutes, all futures week, the bot reads prices and posts any idea its methods spot.
            New ideas only start {etWindowLabel("02:00", "15:25")}, and everything is closed by {etTimeLabel("15:25")}.
          </li>
          <li>
            <b>Test.</b> A method must beat thousands of random entries on years of past prices, pass a separate
            confirmation period, then earn 60 new trades over 20 trading days and two weekly reviews. Past replays
            never count as new trades.
          </li>
          <li>
            <b>Practice.</b> Only then does it trade practice money — first at {usd(PAPER_RISK.probationRisk)} of risk
            a trade, then up to {usd(PAPER_RISK.riskPerTrade)}. All open trades together risk at most{" "}
            {usd(PAPER_RISK.totalOpenRisk)}. A {usd(PAPER_RISK.dailyLoss)} daily loss stops it for the day, and a{" "}
            {usd(PAPER_RISK.maxDrawdown)} drop from its high locks the account until someone resets it.
          </li>
        </ol>
        <p>
          Every week the bot also tests any method marked &ldquo;Not tested yet&rdquo; against random entries by itself,
          and reports the result on Bot. It never promotes a method on its own — a person has to.
        </p>
        <p className={styles.note}>
          Too little evidence is shown in amber, never red: too little data is not a loss. Red is only for a measured
          loss. Every rate is shown with its n, and below 30 trades it is marked &ldquo;previewed, not judged&rdquo;.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Is the bot working?</h2>
        <dl className={styles.dl}>
          <dt>Running</dt>
          <dd>Price checks are arriving every 15 minutes.</dd>
          <dt>Resting</dt>
          <dd>The market is closed (weekends, holidays). That is the schedule, not a fault.</dd>
          <dt>Prices delayed / Running late</dt>
          <dd>The feed or a check is behind. Ideas catch up on the next pass.</dd>
          <dt>Needs attention</dt>
          <dd>Part of a check had a problem, such as the practice account update. Trade ideas are still checked.</dd>
          <dt>Last check failed</dt>
          <dd>The newest check errored. The next one runs within 15 minutes; a watchdog alerts if it keeps failing.</dd>
        </dl>
        <p>
          The bell in the header lists anything worth a look. Its dot is amber for a warning and red only when something
          failed. News notes alone do not light it.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Your journal</h2>
        <p>
          More → Journal is yours alone. Pick the trading day, type in a trade or import your broker&apos;s file
          (Tradovate and Topstep exports work), and export it any time. Entry and exit times are typed in New York time
          to match the chart. Sign in with your email to keep a private copy across devices; local saving always works.
        </p>
        <p>
          &ldquo;Compare with the bot&rdquo; re-runs the zone method over 60 days in your browser and shows what it did
          on your days. It takes a few seconds, so it only loads when you open it.
        </p>
      </section>

      <section className={styles.card}>
        <h2>ET or IST</h2>
        <p>
          Times follow the ET/IST switch in the header (also under More → Settings). Phones in India start on IST. Two
          things stay in New York time on purpose: trading days (a day&apos;s ideas group by the New York date) and
          journal entry times. Session rules print both clocks, for example flat by {etTimeLabel("15:25")}.
        </p>
      </section>

      <section className={styles.card}>
        <h2>The research room</h2>
        <p>
          More → Research room holds the raw tools: the Strategy Lab (test a method on past prices yourself),
          Diagnostics (the beat-random test, market-year by market-year) and Data (import price files, replay a past
          day). They use statistics words on purpose; tap any underlined word, or see the list below.
        </p>
        <p>
          Methods carry their standing everywhere: <b>red &ldquo;hasn&apos;t beaten chance&rdquo;</b> means tested
          and failed; <b>amber &ldquo;not tested yet&rdquo;</b> means unknown. Lab results never become trade ideas.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Put it on your phone</h2>
        <p>
          iPhone: open the site in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap ⋮, then
          Add to Home screen. It opens straight onto Today.
        </p>
      </section>

      <section className={styles.card} id="words">
        <h2>Words you&apos;ll see</h2>
        <dl className={styles.dl}>
          {GLOSSARY_KEYS.map((k) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{GLOSSARY[k].term}</dt>
              <dd>{GLOSSARY[k].meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.card}>
        <h2>If something looks wrong</h2>
        <ul className={styles.steps}>
          <li>A warning with &ldquo;Try again&rdquo; means a read failed; the screen keeps the last good numbers.</li>
          <li>An idea marked &ldquo;Not resolved yet&rdquo; is left out of every total until the bot records its end.</li>
          <li>A dash (—) means there is no number yet, not zero.</li>
          <li>Still stuck? Check the bell, then Bot → health. The research drawers on Ideas show every excluded row.</li>
        </ul>
      </section>

      <p className={styles.foot}>
        Matches the app as of 2026-10-03 (plain-language mobile redesign). A printable version of this guide lives in
        the project as{" "}
        <a href="https://github.com/veerpatta/aegis-futures-lab/blob/main/docs/user-manual.pdf" target="_blank" rel="noreferrer">
          docs/user-manual.pdf
        </a>
        .
      </p>
    </div>
  );
}
