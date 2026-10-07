/* Zero-cost guard rails. Free quota running out must visibly pause work,
   never spend money and never rotate accounts to dodge a limit.

   Measured inputs: database size (pg_database_size) against the 1 GB free
   project cap, and this month's summed run time against a conservative share
   of the free compute allowance. Thresholds are the plan's proposed defaults:
   70% reduce optional jobs, 85% stop new challenger searches and slow
   collection, 95% essential writes only. */

export const QUOTA_LIMITS = Object.freeze({
  dbBytes: 1024 ** 3,
  /** Seconds of experiment run time a month we allow ourselves (a slice of
      Neon Free's compute; the database also serves the app and the engine). */
  monthRunSec: 20 * 3600,
});

export type QuotaLevel = "normal" | "reduce" | "conserve" | "essential";
export type QuotaAction = "tick" | "record-skip" | "equity-row" | "learn" | "search" | "review";

export function quotaLevel(input: { dbBytes: number | null; monthRunSec: number | null }, limits = QUOTA_LIMITS): QuotaLevel {
  const share = Math.max((input.dbBytes ?? 0) / limits.dbBytes, (input.monthRunSec ?? 0) / limits.monthRunSec);
  if (share >= 0.95) return "essential";
  if (share >= 0.85) return "conserve";
  if (share >= 0.7) return "reduce";
  return "normal";
}

export function quotaShare(input: { dbBytes: number | null; monthRunSec: number | null }, limits = QUOTA_LIMITS): number {
  return Math.max((input.dbBytes ?? 0) / limits.dbBytes, (input.monthRunSec ?? 0) / limits.monthRunSec);
}

/** What each level still allows. Ticks always run so open positions keep
    being managed; at "essential" new ideas are recorded as skips. */
export function allowed(level: QuotaLevel, action: QuotaAction): boolean {
  switch (action) {
    case "tick":
    case "record-skip":
      return true;
    case "equity-row":
    case "learn":
      return level !== "essential";
    case "review":
      return level !== "essential";
    case "search":
      return level === "normal" || level === "reduce";
  }
}

/** Challengers a weekly review may register at this level. */
export function searchBudget(level: QuotaLevel, maxPerWeek: number): number {
  if (level === "normal") return maxPerWeek;
  if (level === "reduce") return Math.min(2, maxPerWeek);
  return 0;
}
