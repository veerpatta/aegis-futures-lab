"use client";

/* One trade idea, readable by someone who has never traded: which way, which
   market, how it was meant to end, how it did end — and, always, whether the
   method behind it has ever beaten chance. Tapping it opens SignalSheet. */

import type { SignalRow } from "@/lib/neon/client";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { fmtStamp } from "@/lib/time/session";
import { money } from "@/lib/format";
import { isStaleOpen } from "@/lib/signals/open-state";
import { badgeForRow, ideaPlain, marketName, outcomeWords } from "@/lib/plain/idea";
import PriceLadder from "./PriceLadder";
import styles from "./idea.module.css";

export default function IdeaCard({
  signal,
  nowSec,
  onOpen,
}: {
  signal: SignalRow;
  nowSec: number | null;
  onOpen: (s: SignalRow) => void;
}) {
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const plain = ideaPlain(signal);
  const badge = badgeForRow(signal);
  const stale = nowSec !== null && isStaleOpen(signal, nowSec);
  const long = signal.direction === "long";
  const closed = signal.exit_price !== null && signal.pnl_usd !== null;
  const tone = stale ? "dim" : closed ? (signal.pnl_usd! >= 0 ? "good" : "bad") : "info";

  return (
    <button
      type="button"
      className={`${styles.card} pressSm`}
      onClick={() => onOpen(signal)}
      aria-label={`${plain.side} ${marketName(signal.symbol)}, ${outcomeWords(signal.status, stale)}. Open details`}
    >
      <span className={styles.top}>
        <span className={`${styles.side} ${long ? styles.sideBuy : styles.sideSell}`}>{plain.side}</span>
        <span className={styles.market}>
          <b>{marketName(signal.symbol)}</b>
          <small>{signal.symbol}</small>
        </span>
        <span className={styles.time}>{fmtStamp(signal.signal_ts, zone)}</span>
      </span>

      <span className={`${styles.standing} ${styles[`standing_${badge.tone}`]}`}>{badge.label}</span>

      <PriceLadder
        stop={signal.stop_price}
        entry={signal.entry_price}
        target={signal.target_price}
        marker={closed ? signal.exit_price : null}
        markerLabel="Exited at"
      />

      <span className={styles.sentence}>{plain.exits}</span>

      <span className={styles.foot}>
        <span className={`${styles.outcome} ${styles[tone]}`}>
          {outcomeWords(signal.status, stale)}
          {closed && <b className="num"> · {mask(money(signal.pnl_usd!))}</b>}
        </span>
        <span className={styles.open}>Details →</span>
      </span>
    </button>
  );
}
