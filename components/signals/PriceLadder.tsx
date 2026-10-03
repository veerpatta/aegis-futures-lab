/* Stop → entry → target as one bar, so the shape of an idea reads at a glance:
   how much room it gave to be wrong against how far it aimed. Red is the
   losing side, green the winning side, the tick is the entry and the ring is
   where it ended (or where price is now). The same left-to-right order works
   for buys and sells because the bar is drawn in "stop to target" space, not
   price space — the numbers under it carry the real prices.

   Extends the legacy Home "risk rail" (design-language §6), which went with
   the legacy page. */

import styles from "./idea.module.css";

const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PriceLadder({
  stop,
  entry,
  target,
  marker = null,
  markerLabel,
}: {
  stop: number;
  entry: number;
  target: number | null;
  /** Exit price for a closed idea, or the latest price for an open one. */
  marker?: number | null;
  markerLabel?: string;
}) {
  /* With no target the bar shows stop and entry only; entry sits at 40%. */
  const span = target === null ? null : target - stop;
  const pct = (v: number): number => {
    if (span === null || span === 0) return v === stop ? 0 : 40;
    return Math.max(0, Math.min(100, ((v - stop) / span) * 100));
  };
  const entryPct = pct(entry);
  const markerPct = marker === null ? null : pct(marker);
  const markerGood = marker !== null && (marker - entry) * Math.sign((target ?? entry + (entry - stop)) - entry) > 0;

  return (
    <span className={styles.ladder}>
      <span className={styles.track} aria-hidden>
        <span className={styles.lossSide} style={{ width: `${entryPct}%` }} />
        <span className={styles.gainSide} style={{ left: `${entryPct}%` }} />
        <span className={styles.entryTick} style={{ left: `${entryPct}%` }} />
        {markerPct !== null && (
          <span
            className={`${styles.marker} ${markerGood ? styles.markerGood : styles.markerBad}`}
            style={{ left: `${markerPct}%` }}
          />
        )}
      </span>
      <span className={styles.ladderLabels}>
        <span>
          <b className={`num ${styles.bad}`}>{fmt(stop)}</b>
          <small>Stop</small>
        </span>
        <span className={styles.mid}>
          <b className="num">{fmt(entry)}</b>
          <small>Entry</small>
        </span>
        <span className={styles.right}>
          <b className={`num ${styles.good}`}>{target === null ? "—" : fmt(target)}</b>
          <small>Target</small>
        </span>
      </span>
      {marker !== null && markerLabel && <span className="sr-only">{`${markerLabel} ${fmt(marker)}`}</span>}
    </span>
  );
}
