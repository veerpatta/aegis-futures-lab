"use client";

/* The detail sheet for one idea — the native pass's replacement for a detail
   page. Opened from Home's live card, Home's recent list, the Signals blotter
   and a Journal day.

   "Why the bot took it" is NOT prose written for the mock. Every bullet comes
   from the same helpers the inline context strip uses (lib/signals/context.ts),
   which means the sample-count rule holds here too: a historical cell never
   appears without its n, and reads "still collecting" below the minimum. */

import Link from "next/link";
import type { SignalRow } from "@/lib/supabase/client";
import {
  describeCell,
  describeInvalidation,
  describeSetup,
  describeWinProb,
  historicalCells,
  type ConditionLedger,
} from "@/lib/signals/context";
import { statusLook } from "@/lib/signals/status";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { fmtStamp } from "@/lib/time/session";
import { money } from "@/lib/format";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import styles from "./signalSheet.module.css";

function tierName(tier: "A" | "B"): string {
  return tier === "A" ? "zone setup" : "daily flow";
}

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

  const open = signal !== null;
  const s = signal;
  const long = s?.direction === "long";
  const look = s ? statusLook(s.status) : null;
  const cells = s ? historicalCells(ledger, s) : [];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={s ? `${long ? "BUY" : "SELL"} ${s.symbol}` : ""}
    >
      {s && (
        <>
          <div className={styles.head}>
            <span className={styles.headLeft}>
              <span className={long ? styles.sideBuy : styles.sideSell}>
                {long ? "BUY" : "SELL"}
              </span>
              <b className={styles.sym}>{s.symbol}</b>
              {look && <span className={`${styles.state} ${styles[look.tone]}`}>{look.label}</span>}
            </span>
            <SheetClose onClose={onClose} />
          </div>

          {/* fmtStamp already carries the zone abbreviation — do not append it. */}
          <div className={styles.meta}>
            {fmtStamp(s.signal_ts, zone)} · {tierName(s.tier)} (Tier {s.tier})
            {s.rr !== null && ` · ${s.rr.toFixed(1)} : 1 reward`}
          </div>

          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>Entry</span>
              <b className={`${styles.tileValue} num`}>{s.entry_price.toFixed(2)}</b>
            </div>
            <div className={styles.tile}>
              <span className={`${styles.tileLabel} ${styles.bad}`}>Stop</span>
              <b className={`${styles.tileValue} num ${styles.bad}`}>{s.stop_price.toFixed(2)}</b>
            </div>
            <div className={styles.tile}>
              <span className={`${styles.tileLabel} ${styles.good}`}>Target</span>
              <b className={`${styles.tileValue} num ${styles.good}`}>
                {s.target_price?.toFixed(2) ?? "—"}
              </b>
            </div>
          </div>

          {s.pnl_usd !== null && (
            <div className={styles.pnlRow}>
              <span className={styles.tileLabel}>Result</span>
              <b className={`num ${s.pnl_usd >= 0 ? styles.good : styles.bad}`}>
                {mask(money(s.pnl_usd))}
              </b>
            </div>
          )}

          <div className={styles.why}>
            <span className={styles.whyTitle}>Why the bot took it</span>
            <span className={styles.bullet}>
              <i aria-hidden />
              {describeSetup(s)}
            </span>
            <span className={styles.bullet}>
              <i aria-hidden />
              Invalidated {describeInvalidation(s)}
            </span>
            <span className={styles.bullet}>
              <i aria-hidden />
              {describeWinProb(s)}
              {s.score !== null && ` · zone score ${s.score}`}
            </span>
            {cells.map((h) => (
              <span
                key={h.label}
                className={h.insufficient ? `${styles.bullet} ${styles.collecting}` : styles.bullet}
              >
                <i aria-hidden />
                {describeCell(h)}
              </span>
            ))}
            {cells.length === 0 && (
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                {ledger === null
                  ? "the nightly knowledge tables have not been built yet"
                  : "no history for this combination of tier and conditions yet"}
              </span>
            )}
            {s.fill_confidence === "marginal" && (
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                Price barely reached the entry level — a real resting order may not have filled
                first time
              </span>
            )}
            {s.fill_confidence === "doubtful" && (
              <span className={`${styles.bullet} ${styles.collecting}`}>
                <i aria-hidden />
                Price only kissed the entry level and never came back — a real order likely never
                filled, so this row is left out of the headline numbers
              </span>
            )}
          </div>

          <div className={styles.actions}>
            <Link href="/replay" className={`${styles.primary} press`} onClick={onClose}>
              Open in journal
            </Link>
            <Link href="/markets" className={`${styles.secondary} press`} onClick={onClose}>
              Chart
            </Link>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
