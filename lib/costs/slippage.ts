/* Time-varying slippage.
 *
 * Pure: same arguments -> same number, no clock, no I/O. Called once per fill
 * (not per bar), so the nyMeta() Intl lookup inside is not on a hot path.
 *
 * Returns POINTS, matching the unit of the legacy scalar ExecutionConfig
 * .slippage. Callers convert to dollars with the symbol's point value.
 */

import { nyMeta } from "@/lib/time/ny";
import type { FrictionSpec } from "./model";

/** Multiplier from the open/close windows. 1 when outside all of them. */
export function windowMultiplier(friction: FrictionSpec, timeSec: number): number {
  if (friction.openCloseWindows.length === 0) return 1;
  const { minutes } = nyMeta(timeSec);
  let mult = 1;
  for (const w of friction.openCloseWindows) {
    // Widest applicable window wins rather than compounding — two overlapping
    // windows should not silently multiply to 2.25x.
    if (minutes >= w.fromMin && minutes < w.toMin) mult = Math.max(mult, w.mult);
  }
  return mult;
}

/** Multiplier from proximity to a scheduled macro release. 1 when disabled. */
export function macroMultiplier(friction: FrictionSpec, timeSec: number): number {
  if (friction.macroMult === 1 || friction.macroTimes.length === 0) return 1;
  for (const t of friction.macroTimes) {
    if (Math.abs(t - timeSec) <= friction.macroWindowSec) return friction.macroMult;
  }
  return 1;
}

/* Slippage in points for one side of one fill.
   Multipliers compose: a macro release during the opening range is worse than
   either alone. */
export function slippagePointsAt(
  friction: FrictionSpec,
  symbol: string,
  timeSec: number,
): number {
  const spec = friction.bySymbol[symbol];
  if (!spec) return 0;
  const base = spec.slippageTicks * spec.tickSize;
  if (base === 0) return 0;
  return base * windowMultiplier(friction, timeSec) * macroMultiplier(friction, timeSec);
}
