"use client";

/* "Bot vs you" — the native pass's headline Journal card.

   Three comparisons across the days you actually journaled: net, win rate and
   average hold. Every figure is computed here from the engine's replayed
   trades and your own logged trades — the comp's "+$1,284 vs +$742" was
   fixture data.

   The closing note is generated from the hold-time gap rather than written,
   and only appears when there is enough on both sides for the comparison to
   mean anything. */

import type { Trade } from "@/lib/types";
import { journalPnl, type JournalTrade } from "@/lib/journal";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { money } from "@/lib/format";
import styles from "./replay.module.css";

/** Below this on either side, a percentage is noise rather than a signal. */
const MIN_N = 3;

interface Side {
  n: number;
  net: number;
  wins: number;
  holdMin: number | null;
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, v) => a + v, 0) / values.length : null;
}

export default function BotVsYou({
  engineTrades,
  userTrades,
  from,
  to,
}: {
  engineTrades: Trade[];
  userTrades: JournalTrade[];
  from: string;
  to: string;
}) {
  const { mask } = usePrivacy();

  const bot: Side = {
    n: engineTrades.length,
    net: engineTrades.reduce((a, t) => a + t.pnl, 0),
    wins: engineTrades.filter((t) => t.pnl > 0).length,
    holdMin: avg(engineTrades.map((t) => (t.exitTime - t.entryTime) / 60)),
  };
  const you: Side = {
    n: userTrades.length,
    net: userTrades.reduce((a, t) => a + journalPnl(t).grossPnl, 0),
    wins: userTrades.filter((t) => journalPnl(t).grossPnl > 0).length,
    holdMin: avg(userTrades.map((t) => (t.exitTime - t.entryTime) / 60)),
  };

  const enough = bot.n >= MIN_N && you.n >= MIN_N;

  /* Bar widths are shares of the pair's total magnitude, so a negative side
     still gets a visible bar rather than collapsing to zero width. */
  const split = (a: number, b: number): [string, string] => {
    const total = Math.abs(a) + Math.abs(b);
    if (total === 0) return ["50%", "50%"];
    return [`${((Math.abs(a) / total) * 100).toFixed(1)}%`, `${((Math.abs(b) / total) * 100).toFixed(1)}%`];
  };

  const rows = [
    {
      k: "Net over the journalled days",
      bot: mask(money(bot.net)),
      you: mask(money(you.net)),
      split: split(bot.net, you.net),
    },
    {
      k: "Win rate",
      bot: bot.n ? `${Math.round((bot.wins / bot.n) * 100)}%` : "—",
      you: you.n ? `${Math.round((you.wins / you.n) * 100)}%` : "—",
      split: split(bot.n ? bot.wins / bot.n : 0, you.n ? you.wins / you.n : 0),
    },
    {
      k: "Average hold",
      bot: bot.holdMin === null ? "—" : `${Math.round(bot.holdMin)} min`,
      you: you.holdMin === null ? "—" : `${Math.round(you.holdMin)} min`,
      split: split(bot.holdMin ?? 0, you.holdMin ?? 0),
    },
    {
      k: "Trades taken",
      bot: String(bot.n),
      you: String(you.n),
      split: split(bot.n, you.n),
    },
  ];

  const holdGap =
    bot.holdMin !== null && you.holdMin !== null ? Math.round(bot.holdMin - you.holdMin) : null;

  return (
    <div className={styles.vsCard}>
      <div className={styles.vsHead}>
        <span className={styles.vsTitle}>Bot vs you</span>
        <span className={styles.vsRange}>
          {from} → {to}
        </span>
      </div>

      {rows.map((r) => (
        <div key={r.k} className={styles.vsRow}>
          <div className={styles.vsLabels}>
            <span className={styles.vsKey}>{r.k}</span>
            <span>
              <b className={styles.vsBot}>{r.bot}</b>{" "}
              <span className={styles.vsWord}>vs</span> <b className={styles.vsYou}>{r.you}</b>
            </span>
          </div>
          <div className={styles.vsBars} aria-hidden>
            <i className={styles.vsBarBot} style={{ width: r.split[0] }} />
            <i className={styles.vsBarYou} style={{ width: r.split[1] }} />
          </div>
        </div>
      ))}

      <p className={styles.vsNote}>
        {!enough
          ? `Log at least ${MIN_N} trades in this window to make the comparison meaningful — right now it is ${bot.n} engine trade${
              bot.n === 1 ? "" : "s"
            } against ${you.n} of yours.`
          : holdGap === null
            ? "Hold times are not available on both sides yet."
            : holdGap > 0
              ? `You close about ${holdGap} min earlier than the bot on average. That gap is usually most of the difference in net.`
              : holdGap < 0
                ? `You hold about ${Math.abs(holdGap)} min longer than the bot on average.`
                : "You and the bot hold for about the same time."}
      </p>
      <p className={styles.vsFoot}>
        Your side is gross of costs — the engine&rsquo;s side already has commission and slippage
        taken out, so a close race favours you on paper.
      </p>
    </div>
  );
}
