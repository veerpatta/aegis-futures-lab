/* Excursion rows for LIVE signals — the one measurement in this app that
   cannot be recovered after the fact.

   Backtest excursion is recomputable from the bars_5m archive whenever it is
   wanted, which is why `20260731220000_phase1_truth_layer.sql` deliberately
   does not store it. Live signals are the opposite case: the bar path around a
   live signal survives only as long as the feed keeps it, so an excursion not
   written on the pass that closed the trade is gone. The table has existed
   since that migration with no writer, so every live signal before this commit
   lost its MAE/MFE permanently.

   Nothing here computes a normalisation of its own. maeR/mfeR/maeAtr/mfeAtr/
   minutesToMae/minutesToMfe all come from `lib/backtest/metrics.ts`, which
   states the one-definition rule and owns the subtlety that makes it matter:
   R divides by the stop AT ENTRY (`stopPoints`), because `t.stop` is the FINAL
   stop and a trade trailed to breakeven sends maeR to infinity. Re-deriving any
   of it here would be a second definition waiting to drift.

   CLOSED trades only. An open position's excursion is still moving, and the
   engine mirrors the trailing LOOKBACK_DAYS on every pass, so a trade that is
   open now is written with its final numbers by a later pass — roughly 670 of
   them before it ages out of the window. Writing open positions would mean
   re-upserting a moving number every 15 minutes to record something that gets
   overwritten anyway. */
import { maeAtr, maeR, mfeAtr, mfeR, minutesToMae, minutesToMfe } from "@/lib/backtest/metrics";
import type { Trade } from "@/lib/types";

/* Bar width of the live feed. Only used to express holding time in bars; the
   engine's own bar spacing is not configurable per stream. */
const BAR_SECONDS = 300;

export interface SignalExcursionRow {
  signal_id: number;
  computed_at: string;
  bar_source: string;
  mae_points: number | null;
  mfe_points: number | null;
  atr_at_entry: number | null;
  mae_atr: number | null;
  mfe_atr: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  minutes_to_mae: number | null;
  minutes_to_mfe: number | null;
  bars_held: number | null;
}

/* Trades reconstructed from stored rows predate the excursion fields and
   legitimately carry none. Writing a row of all-nulls for them would put a
   permanent "measured, found nothing" marker where the truth is "never
   measured" — the same distinction `promotionGate.ts` draws between a failed
   check and an evidence gap. */
export function hasExcursion(t: Trade): boolean {
  return t.maePoints !== undefined || t.mfePoints !== undefined;
}

/* Round to a sane number of decimals without pretending to tick precision.
   These are 5-minute bar highs/lows, not tick data. */
const r = (v: number | null, dp: number): number | null =>
  v === null || !Number.isFinite(v) ? null : +v.toFixed(dp);

export function excursionRow(
  signalId: number,
  t: Trade,
  barSource: string,
  computedAt: string
): SignalExcursionRow {
  return {
    signal_id: signalId,
    computed_at: computedAt,
    bar_source: barSource,
    mae_points: r(t.maePoints ?? null, 4),
    mfe_points: r(t.mfePoints ?? null, 4),
    atr_at_entry: r(t.atrAtEntry ?? null, 4),
    mae_atr: r(maeAtr(t), 4),
    mfe_atr: r(mfeAtr(t), 4),
    mae_r: r(maeR(t), 4),
    mfe_r: r(mfeR(t), 4),
    minutes_to_mae: r(minutesToMae(t), 1),
    minutes_to_mfe: r(minutesToMfe(t), 1),
    bars_held: Math.max(0, Math.round((t.exitTime - t.entryTime) / BAR_SECONDS)),
  };
}
