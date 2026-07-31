"use client";

/* "Live vs tuning window" — the dashboard's honest heart. For each live
   stream, the PF band and trade pace the tuning window promised
   (scripts/engine/tiers.ts TUNING_BASELINE) against what the closed
   signals since go-live actually delivered.

   Verdicts are deliberately slow to judge: with fewer than 20 closed
   signals a stream only says "collecting data, N/20" — never a verdict on
   a handful of trades. After that: tracking (live PF within or above the
   band), lagging (below the band but above 1.0), underwater (PF < 1.0).
   A red state means "stop trusting this stream", not "trade harder".

   REFUTED overrides all of those, and being slow to judge is exactly why it
   has to. Tier A has no live closed trades, so the slow-to-judge rule printed
   "COLLECTING 0/20" underneath a promise of PF 1.05-1.30 — while seven years
   of real CME data had already measured that same configuration at PF 0.55
   over 1,180 trades. Caution about small samples must not become a way of
   never reporting the large one. A refuted stream leads with the out-of-
   sample result and shows its old band only as the claim that failed. */

import { useMemo } from "react";
import type { SignalRow } from "@/lib/supabase/client";
import {
  GO_LIVE_DATE,
  TUNING_BASELINE,
  isRefuted,
  type OutOfSample,
} from "@/scripts/engine/tiers";
import { isMarketHoliday } from "@/lib/market/holidays";
import { nyMeta } from "@/lib/time/ny";
import {
  MIN_VERDICT_N,
  bandVerdict,
  fmtPf,
  profitFactor,
  type BandVerdict,
} from "@/lib/stats";
import { money } from "@/lib/format";
import { SampleNote } from "@/components/ui";
import styles from "./home.module.css";

interface StreamState {
  key: string;
  label: string;
  pfBand: [number, number];
  tradesPerDay: [number, number];
  /* Trades arrive in clusters, not at a rate — the per-day band is a long-run
     average and the panel must not let a quiet week read as a shortfall. */
  clustered: boolean;
  /* The band was tested on data it was not fitted to and failed. Present ⇒ the
     tuned band is history and must not be shown as a live expectation. */
  refutedBy: OutOfSample | null;
  total: number;
  closed: number;
  pf: number | null;
  net: number;
  perDay: number | null;
  exPf: number | null;
  exNet: number;
  verdict: BandVerdict;
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
      const refuted = isRefuted(b);
      return {
        key: b.key,
        label: b.label,
        pfBand: b.pfBand,
        tradesPerDay: b.tradesPerDay,
        clustered: b.clustered === true,
        refutedBy: refuted ? b.outOfSample ?? null : null,
        total: rows.length,
        closed: closed.length,
        pf,
        net: pnls.reduce((a, v) => a + v, 0),
        perDay: rows.length ? rows.length / days : null,
        exPf: profitFactor(exPnls),
        exNet: exPnls.reduce((a, v) => a + v, 0),
        verdict: bandVerdict(closed.length, pf, b.pfBand, refuted),
      };
    });
  }, [signals]);

  const look: Record<StreamState["verdict"], { label: string; cls: string }> = {
    collecting: { label: "COLLECTING", cls: styles.info },
    tracking: { label: "TRACKING", cls: styles.good },
    lagging: { label: "LAGGING", cls: styles.warn },
    underwater: { label: "UNDERWATER", cls: styles.bad },
    refuted: { label: "REFUTED", cls: styles.bad },
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
                ? `COLLECTING ${s.closed}/${MIN_VERDICT_N}`
                : look[s.verdict].label}
            </span>
          </div>
          {/* A refuted stream must not lead with its tuned band. The band is
              the claim that failed; showing it first, with the live figures
              beside it, reads as "not proved yet" when the truth is the
              opposite. So the out-of-sample result goes first and the band
              follows, marked as the thing it disproved. */}
          {s.refutedBy ? (
            <>
              <div className={styles.gapMeta}>
                out of sample: <b className="num">{s.refutedBy.trades.toLocaleString()}</b> trades
                over <b className="num">{s.refutedBy.sessions.toLocaleString()}</b> sessions · PF{" "}
                <b className={`num ${styles.bad}`}>{s.refutedBy.pf.toFixed(2)}</b> · net{" "}
                <b className={`num ${styles.bad}`}>{money(s.refutedBy.net)}</b> · avg R{" "}
                <b className={`num ${styles.bad}`}>{s.refutedBy.avgR.toFixed(2)}</b>
              </div>
              <div className={styles.gapMeta}>
                live since {GO_LIVE_DATE}: PF <b className="num">{fmtPf(s.pf)}</b> ·{" "}
                <b className="num">{s.perDay === null ? "—" : s.perDay.toFixed(2)}</b>/day · net{" "}
                <b className={`num ${s.net >= 0 ? styles.good : styles.bad}`}>{money(s.net)}</b>
              </div>
            </>
          ) : (
            <div className={styles.gapMeta}>
              tuned PF {s.pfBand[0].toFixed(2)}–{s.pfBand[1].toFixed(2)} ·{" "}
              {s.tradesPerDay[0]}–{s.tradesPerDay[1]}/day&ensp;→&ensp;live PF{" "}
              <b className="num">{fmtPf(s.pf)}</b> ·{" "}
              <b className="num">{s.perDay === null ? "—" : s.perDay.toFixed(2)}</b>/day · net{" "}
              <b className={`num ${s.net >= 0 ? styles.good : styles.bad}`}>{money(s.net)}</b>
            </div>
          )}
          {/* The COLLECTING badge shows n only while a stream is below the
              verdict threshold. Past it the figures would otherwise go bare,
              so the gate is stated for every stream at every size. */}
          <SampleNote n={s.closed} />
          <div className={`${styles.gapMeta} ${styles.dim}`}>
            excluding doubtful fills: PF {fmtPf(s.exPf)} · net {money(s.exNet)}
          </div>
          {s.refutedBy && (
            <div className={`${styles.gapMeta} ${styles.dim}`}>
              this stream was tested on data it was not tuned on and <b>lost money</b>. It keeps
              running on paper so the number keeps updating, but the band it used to advertise (PF{" "}
              {s.pfBand[0].toFixed(2)}–{s.pfBand[1].toFixed(2)}) came from a far smaller sample and
              did not hold. Do not trade it.
            </div>
          )}
          {s.clustered && !s.refutedBy && (
            <div className={`${styles.gapMeta} ${styles.dim}`}>
              this stream <b>clusters</b> — the per-day figure is a long-run average, not a pace to
              expect. Whole quiet weeks are normal and are not a shortfall.
            </div>
          )}
        </div>
      ))}
      <span className={styles.note}>
        since {GO_LIVE_DATE} · paper results · a red stream means &ldquo;stop trusting it&rdquo;,
        never &ldquo;trade harder&rdquo;
      </span>
    </section>
  );
}
