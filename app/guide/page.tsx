import type { Metadata } from "next";
import { GLOSSARY, GLOSSARY_KEYS } from "@/lib/glossary";
import { EXP_RISK } from "@/lib/experiment/policy";
import { PREREG } from "@/lib/experiment/prereg";
import { HIST_RULES } from "@/lib/history/rules";
import { dayWords } from "@/lib/plain/history";
import { etTimeLabel, etWindowLabel } from "@/lib/time/zones";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: "How to use this app — Aegis Futures Lab",
  description:
    "A plain-English guide to Aegis: the five tabs, one virtual account on delayed prices, historical practice, trade ideas, and how a method earns trust.",
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
          Aegis uses one <b>virtual {usd(EXP_RISK.capital)} account</b>. Its <b>experimental learner</b> simulates trades on delayed prices and keeps an honest record of fills, costs and skips. <b>No method has beaten chance yet.</b> Virtual trading is practice, not proof that anything makes money. Trade ideas are not advice.
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
            two markets, the latest trade ideas and any big news coming up.
          </dd>
          <dt>Trades</dt>
          <dd>
            Every idea the learner decided on, taken or skipped, with the reason. Tap one for the evidence: the values
            saved when it decided, the simulated fill, the exit, costs and the result.
          </dd>
          <dt>Learn</dt>
          <dd>
            The model in charge, the candidates being tested, every review&apos;s verdict and the full change history.
            Open Historical practice for the older-data study. Method research sits behind a separate panel; it does not show another account balance.
          </dd>
          <dt>Chart</dt>
          <dd>
            Prices, the price areas the bot watches, the learner&apos;s virtual trades as arrows, why there is no idea
            right now, and the big news it steps aside for.
          </dd>
          <dt>More</dt>
          <dd>
            Trade ideas (Ideas) and their history (Review), method research, historical practice, your Journal, this
            Guide, settings (ET or IST, hide money) and the research room.
          </dd>
        </dl>
        <p className={styles.note}>
          Any word with a dotted underline can be tapped for a short meaning. Close a sheet with its ✕ or Escape.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Read the widgets</h2>
        <ul>
          <li><b>Your day at a glance.</b> Today shows the bot&apos;s recorded activity, trades closed today, open trades and the next expected check. Tap a count to open Trades. Each market&apos;s Open chart link selects that market.</li>
          <li><b>Account journey.</b> The line joins the starting balance, saved daily closes and the latest estimate. It is not a tick-by-tick chart. Open results can still change.</li>
          <li><b>Trade cards.</b> The large number is the final result after costs, or an estimate for an open trade. The price bar shows the stop, actual entry and target. The dots below show whether the idea has filled and closed. Waiting and cancelled orders do not show a made-up result.</li>
          <li><b>Find a trade.</b> Tap Open or Closed at the top of Trades, or use the filter row. Tap a card for the decision, fill and exit timeline, costs and saved evidence.</li>
          <li><b>Decisions in this view.</b> The coloured strip counts closed, open, waiting, skipped and unfilled decisions in the cards you have loaded. It follows your filter. More cards can change these counts. They are not the account&apos;s lifetime totals.</li>
          <li><b>Market clock and price range.</b> Chart shows time left in the entry window. Its ring follows that window, including early closes. The price range marks the last close between the low and high of the loaded candles. The dates below say which period it covers. It is not a forecast.</li>
          <li><b>Find a tool.</b> In More, search for a tool by name or what it does. Clear the search to see all tools and the larger clock and privacy controls. These display settings stay on your device.</li>
          <li><b>Open risk.</b> The bar shows how much of the account&apos;s risk allowance is in use. It is not a forecast of the next loss.</li>
          <li><b>Learning progress.</b> On Learn, the ring counts usable examples toward the 50 needed to start training. It is not a score of skill or profitability. A fair review and fresh confirmation need more evidence.</li>
          <li><b>More detail, when needed.</b> Tap Doing, Learning or Data for its reason. Open the timing details for the last check and next expected check. Your phone&apos;s reduced-motion setting turns off the animations. Hide money also hides the account chart.</li>
        </ul>
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
        <h3>Meet the bot on Learn</h3>
        <p>The animated bot shows the latest recorded activity: watching for ideas, following virtual trades, organising examples, testing versions, waiting or needing attention. Watching means it is between scheduled checks, not training continuously. Offline or when a job has not reported back, the animation stops and the reason stays visible. You can pause the animation. It also rests off screen and follows your phone&apos;s reduced-motion setting.</p>
        <p><b>My learning notebook</b> shows usable examples at the last recorded check, with its date, plus versions trained, changes adopted and fresh results. Taken and skipped ideas can both supply examples. A bigger count is more evidence, not proof of better trading. The next milestone explains what is missing. Open <b>The path to a better bot</b> for all the steps.</p>
        <p><b>Working on its own</b> shows expected check, notebook and review times in your selected clock. The jobs continue when you close the app. <b>Recent activity</b> shows recorded job times and outcomes. Open <b>Example quality at the last check</b> for usable examples, waiting outcomes and exclusions. Its date matters; it is a report from that check.</p>
        <p>The bot uses stored outcomes and small models on the existing service. It makes no paid AI calls or new data purchases. Identical training inputs share one calculation within a review. Unchanged datasets are reused. The normal review, risk and fresh-evidence requirements still apply. Usage limits can defer optional work; the app&apos;s usage guard is not a provider billing meter.</p>
        <p>
          The learner is the bot&apos;s own <b>virtual {usd(EXP_RISK.capital)}</b> account. After each complete market update, it processes ideas and price bars in market-time order. It decides after the idea&apos;s bar closes and fills on the next available bar. It does not wait again just because the feed arrived late. Skipped ideas are followed too, so it cannot learn only from its own winners.
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
            touches both stop and target counts as the stop. A gap through the stop fills at the worse price. If the
            next market period has no price, the order waits; the app never invents a price. It can fill fewer contracts
            if risk is higher at the opening price. Filled trades show the actual size. Waiting and cancelled orders
            are labelled separately.
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
          The repaired account replays ideas from 7 October 2026. Those trades and later delayed-market fills are labelled &ldquo;Simulated on delayed prices&rdquo;. The time of the simulated decision and the actual time the idea was received are shown separately. Earlier skipped attempts remain under Trades → Earlier attempts. Replay results can help train and test candidates, but never count as fresh evidence for a model taking over. Synthetic test prices never count as market evidence. Only the owner can pause it through the project&apos;s GitHub controls. Offline, the app is read-only.
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
            moment, using the historical study&apos;s original receipt-time rules, about 25 minutes late at the next 15-minute check. This study stays separate from the virtual account&apos;s delayed market clock. Gaps and contract-roll jumps in the old data are marked and the
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
            reviews — like any other candidate. Old data counts for none of these. Practice results still go into the
            learning record. Fresh confirmation waits while
            the account uses delayed simulations. The older candidate remains saved.
          </li>
        </ol>
        <p>
          Learn → Historical practice shows an evidence checklist: <b>Data ready</b>, <b>Historical test complete</b>,{" "}
          <b>Fresh confirmation waiting</b> and <b>Validated paper improvement</b>. There is no maturity score, and the
          last line never means proven for real money. &ldquo;No validated improvement yet&rdquo; is an honest result, not
          a fault.
        </p>
        <p className={styles.note}>
          The study never refills or resets the virtual account and never adds old profit to it. It runs at $0 on data the
          project already holds, in short capped runs, and pauses itself when the free limits run low.
        </p>
      </section>

      <section className={styles.card}>
        <h2>One virtual account and separate records</h2>
        <p><b>The experimental learner</b> uses the only active virtual account. Today, Trades and Learn show the same balance and trade history.</p>
        <p><b>Trade ideas</b> are the methods&apos; separate research record. Their own results are never added to the account balance.</p>
        <p><b>Your journal</b> records your own decisions. It does not change the bot&apos;s money.</p>
        <p>The earlier qualification account is retired. Its old record is kept for audit, and the qualification tests remain under More → Method research. Historical practice on years of older data stays separate and never adds old profit to the account.</p>
      </section>

      <section className={styles.card}>
        <h2>How a method earns trust</h2>
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
            <b>Qualification.</b> Passing every check records a research result. It does not start a second account
            or turn replay results into fresh proof. The virtual account keeps the limits listed above.
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
          <dd>Part of a check had a problem, such as the virtual account update. Trade ideas are still checked.</dd>
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
        Matches the app as of 2026-10-08 (widgets across all five tabs). A printable version of this guide lives in
        the project as{" "}
        <a href="https://github.com/veerpatta/aegis-futures-lab/blob/main/docs/user-manual.pdf" target="_blank" rel="noreferrer">
          docs/user-manual.pdf
        </a>
        .
      </p>
    </div>
  );
}
