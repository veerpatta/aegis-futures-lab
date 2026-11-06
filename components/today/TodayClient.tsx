"use client";

/* Today — the one-glance screen (plan: docs/superpowers/plans/2026-11-07-free-ai-and-ui-revamp.md).

   It answers, in order: is the bot working, how is the virtual money, what
   happened today in plain words, what did it do, is it learning, and what is
   the market doing. Everything else (the method ideas list, the check-by-check
   activity, research numbers) moved to Trades, Learn and More, so this screen
   stays about two phone screens long. On wide screens it splits into two
   columns: the account on the left, activity on the right.

   No 60-day price history is downloaded here (e2e/feed-routing.spec.ts holds
   that line), only two thinned quotes. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/components/providers/DataProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { useNowSec } from "@/components/signals/useSignalFeed";
import UpdatedAgo from "@/components/ui/UpdatedAgo";
import { Term } from "@/components/ui/Glossary";
import { fmtStamp } from "@/lib/time/session";
import { BalanceCard, LatestTrades, LearningCard, MarketsCard, StatusCard, StoryCard } from "./TodayCards";
import page from "@/components/ui/page.module.css";
import s from "./home.module.css";

const GUIDE_SEEN_KEY = "aegis.guideSeen.v1";

export default function TodayClient() {
  const nowSec = useNowSec();
  const exp = useExperiment();
  const { zone } = useZone();
  const { events } = useData();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    try {
      setShowTour(localStorage.getItem(GUIDE_SEEN_KEY) !== "1");
    } catch {
      /* storage blocked: just don't show the banner */
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

  const nextNews = useMemo(
    () =>
      events
        .filter((e) => nowSec !== null && new Date(e.time).getTime() > nowSec * 1000)
        .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null,
    [events, nowSec],
  );

  return (
    <div className={`${page.page} ${page.wide}`}>
      <header className={page.head}>
        <h1 className="pageTitle">Today</h1>
        <p className={page.paperLine}>Virtual money only · Prices delayed 10–15 minutes · No real orders</p>
        <UpdatedAgo at={exp.loadedAt} failed={exp.failed} />
      </header>

      {showTour && (
        <aside className={s.tour} aria-label="Getting started">
          <span>New here? A two-minute guide explains every screen.</span>
          <span>
            <Link href="/guide#start" onClick={dismissTour}>Read the guide</Link>
            {" · "}
            <button type="button" className={page.linkButton} onClick={dismissTour}>Not now</button>
          </span>
        </aside>
      )}

      <div className={s.grid}>
        <div className={s.col}>
          <StatusCard now={nowSec} />
          <BalanceCard />
          <StoryCard now={nowSec} />
        </div>
        <div className={s.col}>
          <LatestTrades />
          <LearningCard now={nowSec} />
          <MarketsCard now={nowSec} />
          {nextNews && (
            <section className={s.news} aria-label="Coming up">
              <span aria-hidden>⚑</span>
              <span>
                <b>{nextNews.name}</b> · {fmtStamp(nextNews.time, zone)}
                <br />
                <span className={page.note}>
                  <Term k="newsPause">The bot pauses new ideas 30 minutes either side.</Term>
                </span>
              </span>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
