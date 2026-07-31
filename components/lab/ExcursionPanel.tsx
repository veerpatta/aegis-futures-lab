"use client";

/* MAE / MFE and the R-multiple distribution, on screen.

   The engine has recorded excursion since the MAE/MFE commit and metrics.ts
   has derived it, but nothing displayed it — computed, tested, and invisible.
   This is the surface for it, and it deliberately answers questions rather
   than listing metrics:

     "how much heat did the winners make me sit through?"  → winners' MAE
     "were the losers green first?"                        → losers' MFE
     "how much of the move did I actually keep?"           → exit efficiency

   The distribution matters for the same reason: two books with identical avgR
   can be a 0.5R grind and one 14R lottery win against thirty −1R losers, and
   only one of those survives a bad month. */

import { excursionSummary, rDistribution } from "@/lib/backtest/metrics";
import type { Trade } from "@/lib/types";
import { Panel, SampleNote } from "@/components/ui";
import { money } from "@/lib/format";
import styles from "./lab.module.css";

const r = (v: number | null, digits = 2) => (v === null ? "—" : `${v.toFixed(digits)}R`);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);

export default function ExcursionPanel({ trades }: { trades: Trade[] }) {
  const ex = excursionSummary(trades);
  const dist = rDistribution(trades);
  const maxCount = Math.max(1, ...dist.map((b) => b.count));

  if (!trades.length) return null;

  return (
    <>
      <Panel
        title="How far trades ran"
        hint="worst drawdown and best run while the trade was open, in R"
      >
        {ex.n === 0 ? (
          <p className={styles.note}>
            These trades were produced before excursion was recorded, so there is nothing to
            measure. Re-run the backtest.
          </p>
        ) : (
          <>
            <dl className={styles.exGrid}>
              <div>
                <dt>Heat on the winners</dt>
                <dd className="num">{r(ex.avgWinnerMaeR)}</dd>
                <span className={styles.exNote}>
                  How far offside the winners went before working out. A stop tighter than this
                  would have cut them.
                </span>
              </div>
              <div>
                <dt>Losers that were green first</dt>
                <dd className="num">{r(ex.avgLoserMfeR)}</dd>
                <span className={styles.exNote}>
                  How far onside the losers got before dying. If this is high, a breakeven rule
                  pays for itself.
                </span>
              </div>
              <div>
                <dt>Kept of the best move</dt>
                <dd className="num">{pct(ex.avgExitEfficiency)}</dd>
                <span className={styles.exNote}>
                  Realised R over the best R ever showing. Low means exiting early — or holding
                  well past the turn.
                </span>
              </div>
              <div>
                <dt>Average worst / best</dt>
                <dd className="num">
                  {r(ex.avgMaeR)} / {r(ex.avgMfeR)}
                </dd>
                <span className={styles.exNote}>
                  Across every trade, not just winners or losers.
                </span>
              </div>
            </dl>
            <SampleNote n={ex.n} />
            <p className={styles.note}>
              Measured from 5-minute bar highs and lows, so these are bar-resolution — a trade
              that spiked and recovered inside one bar reads as the full spike.
            </p>
          </>
        )}
      </Panel>

      <Panel title="R-multiple distribution" hint="the shape an average hides">
        <div className={styles.rDist}>
          {dist.map((b) => (
            <div key={b.label} className={styles.rRow}>
              <span className={styles.rLabel}>{b.label}</span>
              <div className={styles.rBarTrack}>
                <i
                  className={b.label.startsWith("−") || b.label.startsWith("≤") ? styles.rBarDown : styles.rBarUp}
                  style={{ width: `${(b.count / maxCount) * 100}%` }}
                />
              </div>
              <span className={`${styles.rCount} num`}>{b.count}</span>
              <span className={`${styles.rNet} num`}>{b.count ? money(b.net) : ""}</span>
            </div>
          ))}
        </div>
        <SampleNote n={trades.length} />
        <p className={styles.note}>
          Buckets are finer below zero because losses cluster at −1R, where the stop is. A long
          tail on the right carried by one or two trades is a different business from a stack in
          the middle, even at the same average R.
        </p>
      </Panel>
    </>
  );
}
