"use client";

/* "Bot vs you" on Home — the app's most original idea, made the hero.

   The Journal page already carries a detailed version over the days you
   journalled. This one answers the shorter question you actually open the app
   with: over the same window, did following the rules beat what I did?

   Both sides go through lib/stats.ts, and both are NET — the journal side
   charges the same per-contract commission the engine charges itself. A
   comparison where one side is gross is not a comparison. */

import { useMemo } from "react";
import Link from "next/link";
import type { SignalRow } from "@/lib/supabase/client";
import { loadJournal, journalPnl } from "@/lib/journal";
import { nyMeta } from "@/lib/time/ny";
import { expectancy, rateFromPnls, type RateReadout } from "@/lib/stats";
import { money } from "@/lib/format";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { SampleNote } from "@/components/ui";
import { liveOnly } from "@/lib/signals/live";
import styles from "./home.module.css";

interface SideStat {
  net: number;
  expectancy: number | null;
  rate: RateReadout;
}

const statOf = (pnls: number[]): SideStat => ({
  net: pnls.reduce((a, v) => a + v, 0),
  expectancy: expectancy(pnls),
  rate: rateFromPnls(pnls),
});

export default function BotVsYouHero({ signals }: { signals: SignalRow[] }) {
  const { mask } = usePrivacy();

  const { bot, you, days } = useMemo(() => {
    const journal = loadJournal().trades;
    /* Compare only over the days the user actually journalled. Measuring the
       bot across a window where you were not trading is not a comparison —
       it just says the bot traded more, which is true by construction. */
    const journalDays = new Set(journal.map((t) => nyMeta(t.entryTime).dateKey));

    /* liveOnly first: comparing the human against rows the engine wrote about
       sessions that were already over would flatter the bot by construction —
       the worst place in the app for that, since this card exists to be a fair
       comparison. See lib/signals/live.ts. */
    const botPnls = liveOnly(signals)
      .filter(
        (s) =>
          s.pnl_usd !== null &&
          !s.suppressed &&
          !s.stale_data &&
          journalDays.has(
            nyMeta(Math.floor(new Date(s.exit_ts ?? s.signal_ts).getTime() / 1000)).dateKey
          )
      )
      .map((s) => s.pnl_usd ?? 0);

    const youPnls = journal.map((t) => journalPnl(t).netPnl);

    return { bot: statOf(botPnls), you: statOf(youPnls), days: journalDays.size };
  }, [signals]);

  /* Nothing journalled: say so and point at the fix. An empty comparison
     rendered as "0 vs 0" would look like a result. */
  if (days === 0)
    return (
      <section className={styles.card} aria-label="Bot vs you">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Bot vs you</h2>
          <Link href="/replay" className={styles.cardLink}>
            Journal →
          </Link>
        </div>
        <p className={styles.emptyNote}>
          Log a trade on the Journal page and this compares your results against the bot&rsquo;s
          over the same days — both after costs. It is the only number here that is about you.
        </p>
      </section>
    );

  const rows: { k: string; bot: string; you: string; botWins: boolean | null }[] = [
    {
      k: "Expectancy per trade",
      bot: bot.expectancy === null ? "—" : mask(money(bot.expectancy)),
      you: you.expectancy === null ? "—" : mask(money(you.expectancy)),
      botWins:
        bot.expectancy === null || you.expectancy === null
          ? null
          : bot.expectancy > you.expectancy,
    },
    {
      k: "Net",
      bot: mask(money(bot.net)),
      you: mask(money(you.net)),
      botWins: bot.net === you.net ? null : bot.net > you.net,
    },
    {
      k: "Win rate",
      bot: bot.rate.valueLabel,
      you: you.rate.valueLabel,
      /* Deliberately no winner marked on win rate. It is the row most likely
         to be read as a verdict and least able to support one — a higher win
         rate at a worse expectancy is a worse strategy. */
      botWins: null,
    },
  ];

  return (
    <section className={styles.card} aria-label="Bot vs you">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Bot vs you</h2>
        <span className={styles.cardHint}>
          {days} day{days === 1 ? "" : "s"} you journalled · both after costs
        </span>
        <Link href="/replay" className={styles.cardLink}>
          Full comparison →
        </Link>
      </div>

      <div className={styles.vsGrid}>
        <span />
        <span className={styles.vsColBot}>Bot</span>
        <span className={styles.vsColYou}>You</span>
        {rows.map((r) => (
          <div key={r.k} className={styles.vsLine}>
            <span className={styles.vsRowKey}>{r.k}</span>
            <b className={`num ${r.botWins === true ? styles.good : ""}`}>{r.bot}</b>
            <b className={`num ${r.botWins === false ? styles.good : ""}`}>{r.you}</b>
          </div>
        ))}
      </div>

      <div className={styles.vsSampleRow}>
        <span>
          <span className={styles.vsColBot}>Bot</span> <SampleNote n={bot.rate.n} />
        </span>
        <span>
          <span className={styles.vsColYou}>You</span> <SampleNote n={you.rate.n} />
        </span>
      </div>
    </section>
  );
}
