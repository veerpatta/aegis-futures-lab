"use client";

/* The native pass's Signals screen: one segmented switch over three readings
   of the same data — what is working right now, which zones price is walking
   into, and what has already closed. Each card opens the detail sheet.

   The confidence ring is the model's win probability (`win_prob`, Ring 1b).
   Rows written before the model existed have none, and the ring says so with
   a dashed track and "not scored" rather than inventing a number — the comp's
   `conf: '78'` was fixture data.

   Zones carry no confidence field at all, so their cards show distance from
   the delayed price instead of a ring. */

import type { SignalRow, ZoneRow } from "@/lib/supabase/client";
import { statusLook } from "@/lib/signals/status";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { fmtTime } from "@/lib/time/session";
import { ZONE_ABBR } from "@/lib/time/zones";
import { money } from "@/lib/format";
import styles from "./signalCards.module.css";

export type Segment = "live" | "zones" | "history";

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

function ConfidenceRing({ p }: { p: number | null | undefined }) {
  const known = p !== null && p !== undefined;
  const pct = known ? Math.max(0, Math.min(1, p)) : 0;
  const tone = !known ? "var(--text-faint)" : pct >= 0.6 ? "var(--green)" : pct >= 0.45 ? "var(--amber)" : "var(--red)";
  return (
    <span
      className={styles.ring}
      title={known ? `The model puts this at about ${Math.round(pct * 100)}% to win` : "The model has not scored this one yet"}
    >
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r={RING_R} fill="none" stroke="var(--border)" strokeWidth="5" strokeDasharray={known ? undefined : "4 5"} />
        {known && (
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            fill="none"
            stroke={tone}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={RING_C.toFixed(1)}
            strokeDashoffset={(RING_C * (1 - pct)).toFixed(1)}
          />
        )}
      </svg>
      <span className={styles.ringText} style={{ color: known ? undefined : "var(--text-faint)" }}>
        {known ? Math.round(pct * 100) : "—"}
      </span>
    </span>
  );
}

function tierName(tier: "A" | "B"): string {
  return tier === "A" ? "Zone setup" : "Daily flow";
}

export default function SignalCards({
  segment,
  onSegment,
  liveRows,
  historyRows,
  zoneRows,
  loading,
  onOpen,
}: {
  segment: Segment;
  onSegment: (s: Segment) => void;
  liveRows: SignalRow[];
  historyRows: SignalRow[];
  zoneRows: { z: ZoneRow; dist: number | null; inside: boolean; above: boolean }[];
  loading: boolean;
  onOpen: (s: SignalRow) => void;
}) {
  const { zone } = useZone();
  const { mask } = usePrivacy();

  const segs: { id: Segment; label: string }[] = [
    { id: "live", label: `Live · ${liveRows.length}` },
    { id: "zones", label: `Zones · ${zoneRows.length}` },
    { id: "history", label: "History" },
  ];

  const rows = segment === "live" ? liveRows : segment === "history" ? historyRows : [];

  return (
    <section className={styles.wrap} aria-label="Signals at a glance">
      <div className={styles.segment} role="group" aria-label="View">
        {segs.map((s) => (
          <button
            key={s.id}
            type="button"
            className={s.id === segment ? `${styles.seg} ${styles.segOn}` : styles.seg}
            aria-pressed={s.id === segment}
            onClick={() => onSegment(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className={`${styles.list} riseIn`} key={segment}>
        {segment === "zones" ? (
          zoneRows.length === 0 ? (
            <p className={styles.empty}>
              {loading ? "Loading…" : "No zones within reach of the delayed price."}
            </p>
          ) : (
            zoneRows.slice(0, 8).map(({ z, dist, inside, above }) => (
              <article key={z.id} className={styles.zoneCard}>
                <div className={styles.cardTop}>
                  <span className={styles.cardTopLeft}>
                    <span
                      className={`${styles.side} ${
                        z.zone_type === "demand" ? styles.sideBuy : styles.sideSell
                      }`}
                    >
                      {z.zone_type === "demand" ? "BUY AREA" : "SELL AREA"}
                    </span>
                    <b className={styles.sym}>{z.symbol}</b>
                    <span className={styles.kind}>
                      {z.timeframe}
                      {z.fresh ? " · fresh" : ""}
                    </span>
                  </span>
                  <span className={`${styles.dist} ${inside ? styles.warn : styles.dim}`}>
                    {inside
                      ? "AT ZONE"
                      : dist === null
                        ? "—"
                        : `${dist.toFixed(1)}% ${above ? "above" : "below"}`}
                  </span>
                </div>
                <div className={styles.zoneRange}>
                  <span className={styles.cellLabel}>Zone</span>
                  <b className="num">
                    {z.price_low.toFixed(2)} – {z.price_high.toFixed(2)}
                  </b>
                </div>
                <div className={styles.cardFoot}>
                  <span className={styles.note}>
                    {inside
                      ? "Price is inside the zone — the engine looks for its trigger here."
                      : z.achieved
                        ? "Already reached its objective."
                        : z.blocked80
                          ? "Approach is 80% blocked by structure in the way."
                          : "Waiting for price to reach it."}
                  </span>
                </div>
              </article>
            ))
          )
        ) : rows.length === 0 ? (
          <p className={styles.empty}>
            {loading
              ? "Loading…"
              : segment === "live"
                ? "Nothing open or waiting to fill right now."
                : "No closed ideas yet."}
          </p>
        ) : (
          rows.map((s) => {
            const look = statusLook(s.status);
            const long = s.direction === "long";
            return (
              <button
                key={s.id}
                type="button"
                className={`${styles.card} pressSm`}
                onClick={() => onOpen(s)}
                aria-label={`Open ${long ? "buy" : "sell"} ${s.symbol} detail`}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardTopLeft}>
                    <span className={`${styles.side} ${long ? styles.sideBuy : styles.sideSell}`}>
                      {long ? "BUY" : "SELL"}
                    </span>
                    <b className={styles.sym}>{s.symbol}</b>
                    <span className={styles.kind}>{tierName(s.tier)}</span>
                  </span>
                  <span className={styles.time}>
                    {fmtTime(s.signal_ts, zone)} {ZONE_ABBR[zone]}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <ConfidenceRing p={s.win_prob} />
                  <div className={styles.levels}>
                    <span className={styles.level}>
                      <span className={styles.cellLabel}>Entry</span>
                      <b className="num">{s.entry_price.toFixed(2)}</b>
                    </span>
                    <span className={styles.level}>
                      <span className={`${styles.cellLabel} ${styles.bad}`}>Stop</span>
                      <b className={`num ${styles.bad}`}>{s.stop_price.toFixed(2)}</b>
                    </span>
                    <span className={styles.level}>
                      <span className={`${styles.cellLabel} ${styles.good}`}>Target</span>
                      <b className={`num ${styles.good}`}>{s.target_price?.toFixed(2) ?? "—"}</b>
                    </span>
                  </div>
                </div>

                <div className={styles.cardFoot}>
                  <span className={styles.note}>
                    <span className={styles[look.tone]}>{look.label}</span>
                    {s.pnl_usd !== null && (
                      <>
                        {" · "}
                        <span className={`num ${s.pnl_usd >= 0 ? styles.good : styles.bad}`}>
                          {mask(money(s.pnl_usd))}
                        </span>
                      </>
                    )}
                    {s.rr !== null && ` · ${s.rr.toFixed(1)} : 1 reward`}
                  </span>
                  <span className={styles.open}>Open →</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
