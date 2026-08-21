/* Shared funnel vocabulary: human labels for skip reasons and the set of
   diagnostic (non-blocking) reasons excluded from "top blocker" ranking. */

export const FUNNEL_LABELS: Record<string, string> = {
  evaluated: "Setups evaluated",
  noHtf: "No HTF zone in range",
  nesting: "Nesting failed",
  notFresh: "Zone not fresh",
  blocked80: "Blocked by 80% rule",
  weakZone: "Weak-zone exclusion",
  nyCaution: "NY caution (diagnostic)",
  refined15: "Refined to 15M (diagnostic)",
  belowMinScore: "Below minimum score",
  intermarket: "Intermarket disagreement",
  firstZone: "First-zone skip (second-zone rule)",
  noTouch: "Waiting for zone touch",
  noConfirm: "No confirmation candle",
  hours: "Outside entry session",
  riskUnfit: "Risk did not fit",
  stopTooTight: "Stop too tight to be a real fill",
  barGap: "Gap in the price feed between the two bars",
  awaitingSilver: "Gold at its zone, waiting for silver to confirm",
  nyNoConfirm: "New York, no matching silver zone, slow approach",
  staleConfirm: "Silver reached its zone too long ago to count",
  noConfirmSeries: "Silver data missing, cannot confirm",
  noGoldSeries: "Gold data missing — this run has no gold in it",
  shallowZone: "Price has not travelled far enough into the zone",
  news: "News lockout",
  lock: "Discipline lock",
  noSignal: "No trigger",
  qualified: "Qualified",
};

/* Reasons that describe the pipeline rather than a gate that blocked a
   tradeable setup. "noHtf" is also excluded from blocker ranking — it is
   structural (no zone anywhere near price) and would drown every other
   reason; the per-day table shows it in its own column instead. */
export const DIAGNOSTIC_REASONS = new Set([
  "evaluated",
  "qualified",
  "refined15",
  "nyCaution",
  "noHtf",
]);
