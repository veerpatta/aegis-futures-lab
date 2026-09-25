/** Challenger model only. v1 remains the recorded baseline. */
import { featurize, normalizerOf, trainLogit, predictProba, trainingRows, pastEmbargo, type ModelRow, type Normalizer } from "./winprob";
import { nyMeta } from "@/lib/time/ny";
export const V2_FEATURE_VERSION = "winprob-context-v2";
const identities = ["zone-v5", "rsi-reversion", "vwap-reversion", "orb", "bollinger-breakout", "zone-rejection-v2", "rsi-context-v2", "vwap-pullback-v1"];
export function featuresV2(row: ModelRow, norm: Normalizer): number[] {
  const base = featurize(row, norm), hour = nyMeta(Date.parse(row.signal_ts) / 1000).hour;
  // Remove v1's overnight-as-morning error without changing its oracle.
  if (hour < 8) base[11] = 0;
  return [...base, row.symbol === "MES" ? 1 : 0, row.symbol === "MNQ" ? 1 : 0,
    ...identities.map(id => row.strategy === id ? 1 : 0), hour < 8 ? 1 : 0,
    row.atr_pct == null ? 0 : Math.max(0, Math.min(10, row.atr_pct)), row.atr_pct == null ? 1 : 0,
    row.vwap_atr == null ? 0 : Math.max(-10, Math.min(10, row.vwap_atr)), row.vwap_atr == null ? 1 : 0];
}
export function trainContextModel(rows: ModelRow[], asOf: string) {
  const training = trainingRows(rows).filter(r => !!r.exit_ts && Date.parse(r.exit_ts) <= Date.parse(asOf));
  if (training.length < 50) return null;
  let brier = 0, baseline = 0, n = 0, unfiltered = 0, filtered = 0, kept = 0;
  const size = Math.floor(training.length / 6);
  for (let f = 1; f <= 5; f++) {
    const test = training.slice(f * size, f === 5 ? undefined : (f + 1) * size);
    const start = Date.parse(test[0].signal_ts) / 1000;
    const train = training.slice(0, f * size).filter(r => pastEmbargo(Date.parse(r.exit_ts!) / 1000, start));
    if (train.length < 20) continue;
    const norm = normalizerOf(train), labels = train.map(r => r.pnl_usd! > 0 ? 1 : 0);
    const w = trainLogit(train.map(r => featuresV2(r, norm)), labels);
    const baseRate = labels.reduce<number>((a, b) => a + b, 0) / labels.length;
    // The veto threshold is fitted on training data, never ranked on the test fold.
    const distribution = train.map(r => predictProba(w, featuresV2(r, norm))).sort((a, b) => a - b);
    const threshold = distribution[Math.floor(distribution.length * 0.1)];
    for (const row of test) {
      const p = predictProba(w, featuresV2(row, norm)), y = row.pnl_usd! > 0 ? 1 : 0;
      brier += (p - y) ** 2; baseline += (baseRate - y) ** 2; n++; unfiltered += row.pnl_usd!;
      if (p >= threshold) { filtered += row.pnl_usd!; kept++; }
    }
  }
  const normalizer = normalizerOf(training);
  return { model: "winprob-logit-v2", featureVersion: V2_FEATURE_VERSION,
    coefficients: trainLogit(training.map(r => featuresV2(r, normalizer)), training.map(r => r.pnl_usd! > 0 ? 1 : 0)),
    normalizer, train_n: training.length, oos_n: n, kept_n: kept,
    oos_brier: n ? brier / n : null, baseline_brier: n ? baseline / n : null,
    unfiltered_net: unfiltered, filtered_net: filtered,
    qualifies: n >= 150 && brier < baseline && filtered > unfiltered && filtered > 0,
  };
}
