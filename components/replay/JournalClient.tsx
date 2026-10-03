"use client";

/* Journal — your own trades first.

   Logging a trade is the job here, so the journal (form, list, CSV import and
   private sync) opens immediately with today's New York date. Comparing
   yourself with the bot is one tap down: it re-runs the zone method over 60
   days of prices in the browser, which is slow on a phone, so it only loads
   when you open it. A Lab "open in journal" link (?d=…) opens it directly.

   Entry times stay typed in New York time to match the chart (CLAUDE.md). */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { loadJournal, type JournalStore } from "@/lib/journal";
import { nyMeta } from "@/lib/time/ny";
import { Term } from "@/components/ui/Glossary";
import JournalPanel from "./JournalPanel";
import ReplayClient from "./ReplayClient";
import page from "@/components/ui/page.module.css";
import styles from "./replay.module.css";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default function JournalClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlDay = searchParams.get("d");
  const [today, setToday] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalStore>({ version: 1, trades: [] });
  // Open straight onto the comparison when a link asked for a specific day.
  const [compare, setCompare] = useState(() => Boolean(urlDay));

  useEffect(() => {
    setJournal(loadJournal());
    setToday(nyMeta(Date.now() / 1000).dateKey);
  }, []);

  const selectedDay = urlDay && DATE_KEY.test(urlDay) ? urlDay : today;

  const pickDay = (d: string) => {
    if (!DATE_KEY.test(d)) return;
    const q = new URLSearchParams(searchParams.toString());
    q.set("d", d);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Journal</h1>
        <p className={page.lede}>
          Your own trades, private to you and kept apart from the bot. Type them in or import your broker&apos;s file.
        </p>
        <p className={page.paperLine}>Practice only · Delayed prices · No real money</p>
      </header>

      <div className={page.setting} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-card)" }}>
        <span className={page.rowMain}>
          <b>Trading day</b>
          <span>New trades are added to this New York date.</span>
        </span>
        <input
          type="date"
          className={styles.dayInput}
          value={selectedDay ?? ""}
          max={today ?? undefined}
          onChange={(e) => pickDay(e.target.value)}
          aria-label="Trading day for new trades"
        />
      </div>

      {selectedDay ? (
        <JournalPanel selectedDay={selectedDay} journal={journal} onChange={setJournal} />
      ) : (
        <p className={page.loading}>Opening your journal…</p>
      )}

      <details className={page.details} open={compare} onToggle={(e) => setCompare(e.currentTarget.open)}>
        <summary>Compare with the bot — what the zone method did on your days</summary>
        <p className={page.note}>
          Loads 60 days of <Term k="delayed">delayed prices</Term> and re-runs the method here. It takes a few seconds.
        </p>
        {compare && <ReplayClient journal={journal} />}
      </details>
    </div>
  );
}
