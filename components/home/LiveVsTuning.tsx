"use client";

/* "Live vs tuning window" — the dashboard's honest heart. For each live
   stream, the PF band and trade pace the tuning window promised
   (scripts/engine/tiers.ts TUNING_BASELINE) against what the closed
   signals since go-live actually delivered.

   Verdicts are deliberately slow to judge: with fewer than 20 closed
   signals a stream only says "collecting data, N/20" — never a verdict on
   a handful of trades. After that: tracking (live PF within or above the
   band), lagging (below the band but above 1.0), underwater (PF < 1.0).
   A red state means "stop trusting this stream", not "trade harder". */

import { useMemo } from "react";
import type { SignalRow } from "@/lib/supabase/client";
import { GO_LIVE_DATE, TUNING_BASELINE } from "@/scripts/engine/tiers";
import { isMarketHoliday } from "@/lib/market/holidays";
import { nyMeta } from "@/lib/time/ny";
import { fmtPf, profitFactor } from "@/lib/stats";
import { money } from "@/lib/format";
import styles from "./home.module.css";

const MIN_CLOSED = 20; // never render a verdict on fewer closed signals

interface StreamState {
  key: string;
  label: string;
  pfBand: [number, number];
  tradesPerDay: [number, number];
  total: number;
  closed: number;
  pf: number | null;
  net: number;
  perDay: number | null;
  exPf: number | null;
  exNet: number;
  verdict: "collecting" | "tracking" | "lagging" | "underwater";
}

function verdictFor(closed: number, pf: number | null, band: [number, number]): StreamState["verdict"] {
  if (closed < MIN_CLOSED) return "collecting";
  if (pf === null || pf >= band[0]) return "tracking"; // null PF = no losses yet
  if (pf >= 1.0) return "lagging";
  return "underwater";
}

/* NY weekdays since go-live, CME full holidays excluded — the trades/day
   denominator. */
function tradingDaysSinceGoLive(nowSec: number): number {
  let n = 0;
  for (let t = Date.parse(`${GO_LIVE_DATE}T12:00:00Z`) / 1000; t <= nowSec; t += 86400) {
    const m = nyMeta(Math.floor(t));
    if (m.weekday !== "Sat" && m.weekday !== "Sun" && !isMarketHoliday(m.dateKey)) n++;
  }
  return n;
}

export default function LiveVsTuning({ signals }: { signals: SignalRow[] }) {
  const streams = useMemo<StreamState[]>(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const days = Math.max(1, tradingDaysSinceGoLive(nowSec));
    const live = signals.filter(
      (s) => nyMeta(Math.floor(new Date(s.signal_ts).getTime() / 1000)).dateKey >= GO_LIVE_DATE
    );
    return TUNING_BASELINE.map((b) => {
      const rows = live.filter(
        (s) => s.tier === b.tier && (b.symbol === null || s.symbol === b.symbol)
      );
      const closed = rows.filter((s) => s.pnl_usd !== null);
      const pnls = closed.map((s) => s.pnl_usd ?? 0);
      const exPnls = closed
        .filter((s) => s.fill_confidence !== "doubtful")
        .map((s) => s.pnl_usd ?? 0);
      const pf = profitFactor(pnls);
      return {
        key: b.key,
        label: b.label,
        pfBand: b.pfBand,
        tradesPerDay: b.tradesPerDay,
        total: rows.length,
        closed: closed.length,
        pf,
        net: pnls.reduce((a, v) => a + v, 0),
        perDay: rows.length ? rows.length / days : null,
        exPf: profitFactor(exPnls),
        exNet: exPnls.reduce((a, v) => a + v, 0),
        verdict: verdictFor(closed.length, pf, b.pfBand),
      };
    });
  }, [signals]);

  const look: Record<StreamState["verdict"], { label: string; cls: string }> = {
    collecting: { label: "COLLECTING", cls: styles.info },
    tracking: { label: "TRACKING", cls: styles.good },
    lagging: { label: "LAGGING", cls: styles.warn },
    underwater: { label: "UNDERWATER", cls: styles.bad },
  };

  return (
    <section className={`${styles.status} ${styles.card}`} aria-label="Live vs tuning window">
      <h2 className={styles.cardTitle}>Live vs tuning window</h2>
      {streams.map((s) => (
        <div key={s.key} className={styles.gapRow}>
          <div className={styles.gapHead}>
            <span className={styles.gapLabel}>{s.label}</span>
            <span className={`${styles.tag} ${look[s.verdict].cls}`}>
              {s.verdict === "collecting"
                ? `COLLECTING ${s.closed}/${MIN_CLOSED}`
                : look[s.verdict].label}
            </span>
          </div>
          <div className={styles.gapMeta}>
            tuned PF {s.pfBand[0].toFixed(2)}–{s.pfBand[1].toFixed(2)} ·{" "}
            {s.tradesPerDay[0]}–{s.tradesPerDay[1]}/day&ensp;→&ensp;live PF{" "}
            <b className="num">{fmtPf(s.pf)}</b> ·{" "}
            <b className="num">{s.perDay === null ? "—" : s.perDay.toFixed(2)}</b>/day · net{" "}
            <b className={`num ${s.net >= 0 ? styles.good : styles.bad}`}>{money(s.net)}</b>
          </div>
          <div className={`${styles.gapMeta} ${styles.dim}`}>
            excluding doubtful fills: PF {fmtPf(s.exPf)} · net {money(s.exNet)}
          </div>
        </div>
      ))}
      <span className={styles.note}>
        since {GO_LIVE_DATE} · paper results · a red stream means &ldquo;stop trusting it&rdquo;,
        never &ldquo;trade harder&rdquo;
      </span>
    </section>
  );
}
