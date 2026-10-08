"use client";

/* Today shows the single virtual account, markets and source ideas.
   No 60-day price history is downloaded here
   (e2e/feed-routing.spec.ts holds that line), only two thinned quotes. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SignalRow } from "@/lib/neon/client";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useData } from "@/components/providers/DataProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useQuotes } from "@/components/providers/QuoteProvider";
import ExperimentCard from "@/components/experiment/ExperimentCard";
import UpdatedAgo from "@/components/ui/UpdatedAgo";
import { marketPhase, fmtStamp } from "@/lib/time/session";
import { signalSnapshot } from "@/lib/signals/snapshot";
import { MARKET_NAMES } from "@/lib/plain/idea";
import { money } from "@/lib/format";
import { Term } from "@/components/ui/Glossary";
import IdeaCard from "@/components/signals/IdeaCard";
import SignalSheet from "@/components/signals/SignalSheet";
import { useConditionLedger } from "@/components/signals/useConditionLedger";
import { useNowSec, useSignalFeed } from "@/components/signals/useSignalFeed";
import page from "@/components/ui/page.module.css";
import styles from "./today.module.css";

const GUIDE_SEEN_KEY = "aegis.guideSeen.v1";

export default function TodayClient() {
  const nowSec = useNowSec();
  const feed = useSignalFeed();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const { events } = useData();
  const ledger = useConditionLedger();
  const [sheet, setSheet] = useState<SignalRow | null>(null);
  const quotes = useQuotes();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    try {
      setShowTour(localStorage.getItem(GUIDE_SEEN_KEY) !== "1");
    } catch {
      /* storage blocked — just don't show the card */
    }
  }, []);
  const dismissTour = () => {
    setShowTour(false);
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, "1");
    } catch {
      /* fine */
    }
  };

  const snapshot = useMemo(
    () => (nowSec === null || feed.loading ? null : signalSnapshot(feed.rows, nowSec)),
    [feed.rows, feed.loading, nowSec]
  );
  const phase = nowSec === null ? null : marketPhase(nowSec);
  const nextNews = useMemo(
    () =>
      events
        .filter((e) => new Date(e.time).getTime() > Date.now())
        .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null,
    [events]
  );

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Today</h1>
        <p className={page.paperLine}>Virtual only · Delayed prices · No real money</p>
        <UpdatedAgo at={feed.loadedAt} failed={feed.failed} />
      </header>



      <ExperimentCard />

      {showTour && (
        <section className={styles.tour} aria-label="Getting started">
          <div>
            <b>New here?</b>
            <p>A two-minute tour explains the five tabs and how to read a trade idea.</p>
          </div>
          <div className={styles.tourActions}>
            <Link href="/guide#start" className={styles.tourGo} onClick={dismissTour}>
              Read the tour
            </Link>
            <button type="button" className={page.linkButton} onClick={dismissTour}>
              Not now
            </button>
          </div>
        </section>
      )}

      <section className={page.card} aria-label="Markets">
        <div className={styles.marketHead}>
          <span className={phase?.live ? styles.open : styles.closed}>
            <i aria-hidden /> {phase?.label ?? "Checking the market…"}
          </span>
          <span className={page.note}>{phase?.detail ?? ""}</span>
        </div>
        {(["MES", "MNQ"] as const).map((symbol) => {
          const q = quotes[symbol];
          const pct = q && q.previousClose ? (q.change / q.previousClose) * 100 : null;
          return (
            <div key={symbol} className={styles.quote}>
              <span>
                <Term k={symbol === "MES" ? "mes" : "mnq"}>{MARKET_NAMES[symbol]}</Term>
                <small> {symbol}</small>
              </span>
              <span className="num">
                {q ? q.price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                {pct !== null && (
                  <b className={pct >= 0 ? page.good : page.bad}>
                    {" "}
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(2)}%
                  </b>
                )}
              </span>
            </div>
          );
        })}
        <p className={page.note}>
          <Term k="delayed">Delayed 10–15 minutes</Term> · for practice and learning only
        </p>
      </section>

      <section className={page.stack} aria-label="Latest trade ideas">
        <div className={page.sectionHead}>
          <h2>Latest trade ideas</h2>
          <Link href="/signals">All ideas →</Link>
        </div>
        <p className={page.note}>
          A simulated record of what the methods would have done. Each card says what the learner did with it.
          {snapshot && ` ${snapshot.today} new today · ${snapshot.open} open now`}
          {snapshot && snapshot.closed > 0 && ` · today's closed ideas ${mask(money(snapshot.net))} (n=${snapshot.closed})`}
        </p>
        {feed.failed && (
          <p className={page.warning}>
            Ideas could not refresh. {feed.rows.length ? "Showing the previous update." : ""}{" "}
            <button type="button" onClick={feed.refresh}>
              Try again
            </button>
          </p>
        )}
        {feed.loading ? (
          <p className={page.loading}>Loading trade ideas…</p>
        ) : snapshot && snapshot.recent.length ? (
          snapshot.recent.map((s) => <IdeaCard key={s.id} signal={s} nowSec={nowSec} onOpen={setSheet} />)
        ) : (
          <p className={page.empty}>No trade ideas yet. Quiet days are normal — the methods wait for their setups.</p>
        )}
      </section>

      {nextNews && (
        <section className={styles.news} aria-label="Coming up">
          <span className={styles.newsIcon} aria-hidden>
            ⚑
          </span>
          <span>
            <b>{nextNews.name}</b> · {fmtStamp(nextNews.time, zone)}
            <br />
            <span className={page.note}>
              <Term k="newsPause">The bot pauses new ideas 30 minutes either side.</Term>
            </span>
          </span>
        </section>
      )}

      <SignalSheet signal={sheet} ledger={ledger} onClose={() => setSheet(null)} />
    </div>
  );
}
