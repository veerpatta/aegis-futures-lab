import type { Metadata } from "next";
import { GLOSSARY, GLOSSARY_KEYS } from "@/lib/glossary";
import { PAPER_RISK } from "@/lib/paper/policy";
import { EXP_RISK } from "@/lib/experiment/policy";
import { PREREG } from "@/lib/experiment/prereg";
import { HIST_RULES } from "@/lib/history/rules";
import { dayWords } from "@/lib/plain/history";
import { etTimeLabel, etWindowLabel } from "@/lib/time/zones";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "How to use this app — Aegis Futures Lab",
  description:
    "A plain-English guide to Aegis: the five tabs, the experimental learner and its virtual money, historical practice, how to read a trade idea, the practice money, and how the bot earns the right to trade.",
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
          The short version today: <b>no method has beaten chance yet</b>, so the bot has not traded its practice money.
          Meanwhile its <b>experimental learner</b> trades a separate {usd(EXP_RISK.capital)} of <b>virtual money</b> by
          itself and learns under fixed rules, so you can watch it work. That is evidence being collected, not proof
          that anything makes money. The trade ideas you see are a record of what the methods do, not advice.
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
            What the experimental learner is doing, what happened to its virtual money and what it last learned. Then the
            two markets, the practice money, the latest trade ideas and any big news coming up.
          </dd>
          <dt>Trades</dt>
          <dd>
            Every idea the learner decided on, taken or skipped, with the reason. Tap one for the evidence: the values
            saved when it decided, the simulated fill, the exit, costs and the result.
          </dd>
          <dt>Learn</dt>
          <dd>
            The model in charge, the candidates being tested, every review&apos;s verdict and the full change history.
            Then historical practice on older market data. Below that: the bot&apos;s health, its Watch → Test →
            Practice path and the practice money.
          </dd>
          <dt>Chart</dt>
          <dd>
            Prices, the price areas the bot watches, the learner&apos;s virtual trades as arrows, why there is no idea
            right now, and the big news it steps aside for.
          </dd>
          <dt>More</dt>
          <dd>
            Trade ideas (Ideas) and their history (Review), practice money, historical practice, your Journal, this
            Guide, settings (ET or IST, hide money) and the research room.
          </dd>
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

      <section className={styles.card} id="learner">
        <h2>The experimental learner</h2>
        <p>
          The learner is the bot&apos;s own <b>virtual {usd(EXP_RISK.capital)}</b> account. Every 15 minutes it reads the
          newest finished price bars, manages its open trades and decides on every new trade idea: take it, or skip it
          with a reason. Skipped ideas are followed too, so it cannot learn only from its own winners.
        </p>
        <ol className={styles.steps}>
          <li>
            <b>Limits.</b> At most {usd(EXP_RISK.riskPerTrade)} at risk on one trade and {usd(EXP_RISK.totalOpenRisk)}{" "}
            across open trades. A {usd(EXP_RISK.dailyLoss)} daily loss stops it until the next session. A{" "}
            {usd(EXP_RISK.maxDrawdown)} drop from its best stops the campaign for good. It never raises risk after a loss,
            and a new campaign keeps the earlier losses on record.
          </li>
          <li>
            <b>Honest fills.</b> An order fills on the next price after the decision, with costs on both sides. A bar that
            touches both stop and target counts as the stop. A gap through the stop fills at the worse price. With no fresh
            price it takes no new trades and never invents an exit.
          </li>
          <li>
            <b>Nightly.</b> Finished trades go into a numbered learning record. Nothing is learned from a single loss.
          </li>
          <li>
            <b>Weekly.</b> It may test up to {PREREG.search.maxPerWeek} new model versions from a fixed list, side by side
            with the current one on the same fresh ideas. A new version takes over only after {PREREG.gates.minOos} results
            it never trained on, {PREREG.gates.freshSessions} fresh trading days, {PREREG.gates.freshDecisions} fresh ideas
            and two passing reviews at least {PREREG.gates.reviewGapDays} days apart. It must clearly beat the current
            model, not trading at all and random picks, after costs. The old version is kept and comes back automatically
            if the new one does worse.
          </li>
          <li>
            <b>How long a test lasts.</b> At most {PREREG.lifecycle.maxShadowing} candidates are tested at a time, each for
            up to {PREREG.lifecycle.shadowWeeks} weeks, because fresh results come slowly — about one usable idea a day. A
            candidate is retired after {PREREG.lifecycle.maxInconclusive} inconclusive reviews in a row once it has{" "}
            {PREREG.gates.minOos} results it never trained on, or after {PREREG.lifecycle.shadowWeeks} weeks without a
            passing review. A new candidate takes the free place.
          </li>
          <li>
            <b>Why 50 is not enough.</b> Training can start at {PREREG.gates.minTrainRows} finished trades. A fair review
            splits the record into {PREREG.gates.folds + 1} blocks by date, and each of its {PREREG.gates.folds} test
            periods needs {PREREG.gates.minTrainRows} earlier trades to learn from — roughly{" "}
            {PREREG.gates.minTrainRows * (PREREG.gates.folds + 1)}. Periods that are too thin are shown and skipped, never
            counted. Ideas too risky for one contract are not counted at all.
          </li>
        </ol>
        <p>
          Three labels show its state, each with a reason. <b>Doing</b>: watching the market, managing trades, waiting,
          paused, stopped, last check failed or status unknown. <b>Learning</b>: collecting results, candidate ready, change
          adopted, candidate rejected or no proven gain yet. <b>Data</b>: current, late, stale or offline. A missing check
          reads &ldquo;status unknown&rdquo;, never &ldquo;running&rdquo;. &ldquo;No proven gain yet&rdquo; is an honest
          result, not a fault.
        </p>
        <p className={styles.note}>
          Ideas seen more than 30 minutes late are labelled &ldquo;caught up late&rdquo; and never count as fresh
          evidence. Synthetic test prices, if ever used, are labelled on every screen and never count as evidence. Only the
          owner can pause it, through the project&apos;s GitHub controls. Offline, the app is read-only.
        </p>
      </section>

      <section className={styles.card} id="history">
        <h2>Historical practice</h2>
        <p>
          The bot also replays its own older market archive — the S&amp;P and Nasdaq micros from{" "}
          {dayWords(HIST_RULES.scope.from)} to {dayWords(HIST_RULES.scope.to)} — to prepare a better candidate. It is
          practice on old data, kept apart from everything else.
        </p>
        <ol className={styles.steps}>
          <li>
            <b>Only what it could know then.</b> At each old idea it decides with the prices it could have seen at that
            moment, about 25 minutes late like the live learner, at the next 15-minute check. Fills, costs, stops and
            limits work exactly as in the live learner. Gaps and contract-roll jumps in the old data are marked and the
            ideas near them left out — never patched.
          </li>
          <li>
            <b>Counted once.</b> Each idea counts once, however many copies the records hold. Ideas too risky for one
            contract under the {usd(EXP_RISK.riskPerTrade)} limit are not counted.
          </li>
          <li>
            <b>Rules first.</b> The dates, the {HIST_RULES.maxTrials} versions to try and every check were frozen before
            any old result was read. The oldest 60% of trading days trains, the next 20% checks, and the newest 20% is
            tested once. All {HIST_RULES.maxTrials} versions are kept, including the ones that fail.
          </li>
          <li>
            <b>Fair comparisons.</b> Each version is compared on the same ideas with the current model, a simple
            average-rate guess, not trading at all and random picks — with costs doubled as a stress test and with the
            same account limits.
          </li>
          <li>
            <b>Already seen.</b> Earlier research has looked at all of these dates, so the result is marked &ldquo;already
            seen&rdquo;: practice, not proof.
          </li>
          <li>
            <b>Then fresh ideas.</b> A candidate that is not rejected is frozen and watches new ideas beside the current
            model without changing a single decision. It must then pass every adoption check on fresh ideas —{" "}
            {PREREG.gates.freshSessions} fresh trading days, {PREREG.gates.freshDecisions} fresh ideas and two passing
            reviews — like any other candidate. Old data counts for none of these.
          </li>
        </ol>
        <p>
          Learn → Historical practice shows an evidence checklist: <b>Data ready</b>, <b>Historical test complete</b>,{" "}
          <b>Fresh confirmation collecting</b> and <b>Validated paper improvement</b>. There is no maturity score, and the
          last line never means proven for real money. &ldquo;No validated improvement yet&rdquo; is an honest result, not
          a fault.
        </p>
        <p className={styles.note}>
          The study never refills or resets the virtual account and never adds old profit to it. It runs at $0 on data the
          project already holds, in short capped runs, and pauses itself when the free limits run low.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Three kinds of money — never mixed</h2>
        <p>
          <b>Trade ideas</b> are a simulated record: what each method would have done, followed to the end on delayed
          prices. Their results show on Today, Ideas and Review.
        </p>
        <p>
          <b>The experimental learner</b> trades its own virtual {usd(EXP_RISK.capital)}, separately. Its results show on
          Today, Trades and Learn, and are never added to the other two.
        </p>
        <p>
          <b>Practice money</b> is the bot&apos;s own {usd(PAPER_RISK.capital)} paper account. It only trades once a
          method has passed every test, so it has not traded yet. It shows on Today and Learn.
        </p>
        <p className={styles.note}>
          Historical practice is not money at all: its results on older data stay on Learn and are never added to any of
          the three.
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
            a trade, then up to {usd(PAPER_RISK.riskPerTrade)} (
            {Math.round((PAPER_RISK.riskPerTrade / PAPER_RISK.capital) * 1000) / 10}% of the account). All open trades
            together risk at most{" "}
            {usd(PAPER_RISK.totalOpenRisk)}. A {usd(PAPER_RISK.dailyLoss)} daily loss stops it for the day, and a{" "}
            {usd(PAPER_RISK.maxDrawdown)} drop from its high locks the account until someone resets it.
          </li>
        </ol>
        <p>
          Every week the bot also tests any method marked &ldquo;Not tested yet&rdquo; against random entries by itself,
          and reports the result on Learn. It never promotes a method on its own — a person has to.
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
          <li>An open learner trade marked &ldquo;~&rdquo; or &ldquo;stale&rdquo; has no fresh price; its result is an estimate.</li>
          <li>Still stuck? Check the bell, then Learn → health. The research drawers on Ideas show every excluded row.</li>
        </ul>
      </section>

      <p className={styles.foot}>
        Matches the app as of 2026-10-07 (candidate testing time). A printable version of this guide lives in
        the project as{" "}
        <a href="https://github.com/veerpatta/aegis-futures-lab/blob/main/docs/user-manual.pdf" target="_blank" rel="noreferrer">
          docs/user-manual.pdf
        </a>
        .
      </p>
    </div>
  );
}
