"use client";

/* The detail sheet for one trade idea, opened from Today and Ideas.

   Reads top to bottom like an explanation: which way and which market, the
   honest standing of the method behind it, the price ladder, how it was meant
   to end and how it did end, then why the bot took it. The research numbers
   (how this kind of setup has done in conditions like these) sit behind
   "Show the numbers" and keep their sample counts: every historical cell comes
   from lib/signals/context.ts, which never prints a rate without its n and
   says "still collecting" below the minimum. */

import Link from "next/link";
import type { SignalRow } from "@/lib/neon/client";
import { describeCell, describeSetup, historicalCells, type ConditionLedger } from "@/lib/signals/context";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { fmtStamp } from "@/lib/time/session";
import { money } from "@/lib/format";
import { isStaleOpen } from "@/lib/signals/open-state";
import { badgeForRow, ideaPlain, marketName, modelWords, outcomeWords, wrongIf } from "@/lib/plain/idea";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import ShowNumbers from "@/components/ui/ShowNumbers";
import { Term } from "@/components/ui/Glossary";
import PriceLadder from "./PriceLadder";
import styles from "./signalSheet.module.css";

const kindName = (tier: "A" | "B") => (tier === "A" ? "Zone setup" : "Daily flow");

const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export default function SignalSheet({
  signal,
  ledger,
  onClose,
}: {
  signal: SignalRow | null;
  ledger: ConditionLedger | null;
  onClose: () => void;
}) {
  const { zone } = useZone();
  const { mask } = usePrivacy();
  const s = signal;
  const plain = s ? ideaPlain(s) : null;
  const badge = s ? badgeForRow(s) : null;
  const stale = s ? isStaleOpen(s, Math.floor(Date.now() / 1000)) : false;
  const closed = s !== null && s.exit_price !== null && s.pnl_usd !== null;
  const cells = s ? historicalCells(ledger, s) : [];

  return (
    <BottomSheet open={s !== null} onClose={onClose} title={s && plain ? `${plain.side} ${marketName(s.symbol)}` : "Trade idea"}>
      {s && plain && badge && (
        <>
          <div className={styles.head}>
            <span className={styles.headLeft}>
              <span className={s.direction === "long" ? styles.sideBuy : styles.sideSell}>{plain.side}</span>
              <b className={styles.sym}>{marketName(s.symbol)}</b>
              <span className={styles.symCode}>{s.symbol}</span>
            </span>
            <SheetClose onClose={onClose} />
          </div>

          <div className={styles.meta}>
            {fmtStamp(s.signal_ts, zone)} · <Term k="tier">{kindName(s.tier)}</Term>
            {s.rr !== null && (
              <>
                {" · "}
                <Term k="reward">{`${s.rr.toFixed(1)} : 1 reward`}</Term>
              </>
            )}
          </div>

          <p className={`${styles.standing} ${styles[`standing_${badge.tone}`]}`}>
            <Term k={badge.term}>{badge.label}</Term>
            {badge.tone === "red" && " — this is a record of what it did, not advice."}
          </p>

          <PriceLadder stop={s.stop_price} entry={s.entry_price} target={s.target_price} marker={closed ? s.exit_price : null} markerLabel="Exited at" />

          <p className={styles.plain}>{plain.exits}</p>

          <div className={styles.result}>
            <span>{outcomeWords(s.status, stale)}</span>
            {closed && (
              <b className={`num ${s.pnl_usd! >= 0 ? styles.good : styles.bad}`}>
                {mask(money(s.pnl_usd!))} <small>after <Term k="costs">costs</Term></small>
              </b>
            )}
          </div>
          {stale && (
            <p className={styles.note}>
              This idea&apos;s session ended long ago and the bot hasn&apos;t recorded how it finished. It is left out of
              every total.
            </p>
          )}

          <div className={styles.why}>
            <span className={styles.whyTitle}>Why the bot took it</span>
            <span className={styles.bullet}>
              <i aria-hidden />
              {capitalise(describeSetup(s))}
            </span>
            <span className={styles.bullet}>
              <i aria-hidden />
              {wrongIf(s)}
            </span>
            <span className={`${styles.bullet} ${styles.collecting}`}>
              <i aria-hidden />
              {modelWords(s.win_prob)}
            </span>
            {s.fill_confidence === "marginal" && (
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                Price barely reached the entry, so a real order might not have filled the first time.
              </span>
            )}
            {s.fill_confidence === "doubtful" && (
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                Price only touched the entry and left, so a real order likely never filled. This idea is left out of the
                totals.
              </span>
            )}
          </div>

          <ShowNumbers label="How this kind of idea has done">
            <div className={styles.why}>
              {cells.map((h) => (
                <span key={h.label} className={h.insufficient ? `${styles.bullet} ${styles.collecting}` : styles.bullet}>
                  <i aria-hidden />
                  {describeCell(h)}
                </span>
              ))}
              {cells.length === 0 && (
                <span className={`${styles.bullet} ${styles.collecting}`}>
                  <i aria-hidden />
                  {ledger === null
                    ? "The nightly results tables have not been built yet."
                    : "No history yet for this kind of idea in these conditions."}
                </span>
              )}
              {s.score !== null && (
                <span className={styles.bullet}>
                  <i aria-hidden />
                  Zone score {s.score}
                </span>
              )}
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                <span>
                  Rates below 30 trades are faded and marked &ldquo;previewed, not judged&rdquo; —{" "}
                  <Term k="sampleSize">why</Term>.
                </span>
              </span>
            </div>
          </ShowNumbers>

          <div className={styles.actions}>
            <Link href="/replay" className={`${styles.primary} press`} onClick={onClose}>
              Log my own trade
            </Link>
            <Link href="/markets" className={`${styles.secondary} press`} onClick={onClose}>
              See the chart
            </Link>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
