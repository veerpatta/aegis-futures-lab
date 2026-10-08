/* One review, one bounded cache. Reuse only identical effective training rows.
   No artifact crosses jobs, cutoffs or folds; fitted values are unchanged. */
import { fitLogit, windowRows, type FittedLogit, type TrainRow } from "./models";
import { stableHash } from "./hash";
import type { ChallengerSpec } from "./types";

export type FitModel = (spec: ChallengerSpec, rows: TrainRow[]) => FittedLogit;

export function createFitCache(maxEntries = 32, fit: FitModel = fitLogit) {
  const cache = new Map<string, FittedLogit>();
  const stats = { computed: 0, reused: 0 };
  const cachedFit: FitModel = (spec, rows) => {
    const effective = windowRows(rows, spec.windowSessions);
    // JSON hashes map NaN/Infinity to null. Never let invalid inputs hit a
    // previous valid fit; leave their handling to the unchanged trainer.
    if (effective.some(r => [r.win, r.net, ...Object.values(r.features)].some(v => typeof v === "number" && !Number.isFinite(v)))) {
      stats.computed++;
      return fit({ ...spec, windowSessions: null }, effective);
    }
    // Row order, labels, costs, sessions and all frozen features matter.
    // Windows may differ while selecting precisely the same training rows.
    const key = stableHash({ featureSet: spec.featureSet, l2: spec.l2, rows: effective });
    const previous = cache.get(key);
    if (previous) { stats.reused++; return previous; }
    const fitted = fit({ ...spec, windowSessions: null }, effective);
    stats.computed++;
    if (maxEntries > 0) {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
      cache.set(key, fitted);
    }
    return fitted;
  };
  return { fit: cachedFit, stats };
}
