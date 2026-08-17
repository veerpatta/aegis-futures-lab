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
import {
  DEFAULT_COMMISSION_PER_CONTRACT,
  journalPnl,
  type JournalTrade,
} from "@/lib/journal";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { money } from "@/lib/format";
import { expectancy, rateReadout, type RateReadout } from "@/lib/stats";
import { SampleNote } from "@/components/ui";
import styles from "./replay.module.css";

/** Below this on either side, the closing note is not worth generating. The
    per-metric display gate is the shared one in lib/stats.ts (n=30) — this is
    only about whether the prose comparison is worth writing at all. */
const MIN_N = 3;

interface Side {
  n: number;
  net: number;
  wins: number;
  holdMin: number | null;
  rate: RateReadout;
  expectancy: number | null;
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

  const botPnls = engineTrades.map((t) => t.pnl);
  const youPnls = userTrades.map((t) => journalPnl(t).netPnl);

  const bot: Side = {
    n: engineTrades.length,
    net: botPnls.reduce((a, v) => a + v, 0),
    wins: botPnls.filter((v) => v > 0).length,
    holdMin: avg(engineTrades.map((t) => (t.exitTime - t.entryTime) / 60)),
    rate: rateReadout(botPnls.filter((v) => v > 0).length, botPnls.length),
    expectancy: expectancy(botPnls),
  };
  const you: Side = {
    n: userTrades.length,
    net: youPnls.reduce((a, v) => a + v, 0),
    wins: youPnls.filter((v) => v > 0).length,
    holdMin: avg(userTrades.map((t) => (t.exitTime - t.entryTime) / 60)),
    rate: rateReadout(youPnls.filter((v) => v > 0).length, youPnls.length),
    expectancy: expectancy(youPnls),
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
    /* Expectancy leads: it is the only row that survives a different number of
       trades on each side, which is the normal case here. */
    {
      k: "Expectancy per trade",
      bot: bot.expectancy === null ? "—" : mask(money(bot.expectancy)),
      you: you.expectancy === null ? "—" : mask(money(you.expectancy)),
      split: split(bot.expectancy ?? 0, you.expectancy ?? 0),
    },
    /* The interval rides along with the rate rather than sitting in the
       sample footer, where it would read as bounding every row above it. */
    {
      k: "Win rate (95% CI)",
      bot: bot.rate.ciLabel
        ? `${bot.rate.valueLabel} (${bot.rate.ciLabel})`
        : bot.rate.valueLabel,
      you: you.rate.ciLabel
        ? `${you.rate.valueLabel} (${you.rate.ciLabel})`
        : you.rate.valueLabel,
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

      {/* Both sample sizes stated separately, because they are almost never
          equal — the bot trades every setup and you trade some of them. */}
      <div className={styles.vsSamples}>
        <span>
          <span className={styles.vsBot}>Bot</span> <SampleNote n={bot.rate.n} />
        </span>
        <span>
          <span className={styles.vsYou}>You</span> <SampleNote n={you.rate.n} />
        </span>
      </div>

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
        Both sides are net of costs. Your trades are charged the same $
        {DEFAULT_COMMISSION_PER_CONTRACT.toFixed(2)} per contract in commission the bot charges
        itself. The bot pays one more thing you do not: a tick of slippage built into its entry
        price, because its fills are simulated. Your entry price is what you actually got, so it
        already includes whatever slippage you paid. That leaves the bot carrying about $3.65 per
        contract on MES and $2.90 on MNQ against your $2.40 — a real difference, and one that
        counts against the bot rather than you.
      </p>
    </div>
  );
}
