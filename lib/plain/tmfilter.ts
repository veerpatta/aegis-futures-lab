/* The time machine filter test, in plain words
   (docs/research/2026-11-12-time-machine-filter-preregistration.md).
   Sentences are built from stored numbers; nothing is typed as a figure. */

import { TM_FILTER_RULES } from "@/lib/tm-study/rules";

export const TMF_NAME = "Time machine filter test";
export const TMF_SUMMARY = "Time machine filter test · can it pick better trades?";
export const TMF_LEDE =
  "Can the time machine make the bot trade better? The rule was written down and locked before any result: skip an idea when the time machine's average replay, after one contract's costs, is below zero. It is tested two ways, on years of past ideas and on the bot's new decisions.";

export type TmfVerdict = "pass" | "fail" | "inconclusive";

export function tmfVerdictWords(v: TmfVerdict | null, kind: "historical" | "forward"): { head: string; tone: "good" | "bad" | "warn"; body: string } {
  if (v === null)
    return kind === "historical"
      ? { head: "Not run yet", tone: "warn", body: "The test on past ideas has not been run yet." }
      : { head: "Collecting", tone: "warn", body: "Too few finished decisions for a first look yet." };
  if (v === "pass")
    return kind === "historical"
      ? { head: "Passed", tone: "good", body: "Skipping the ideas it scored below zero beat taking every idea and beat random skips, and the kept ideas made money after costs. The filter is now eligible to shadow in the learner. The learner's own rules decide whether it ever takes charge of trades." }
      : { head: "Passed", tone: "good", body: "On new decisions too, the filter beat taking every idea and random skips. It is eligible for a future campaign." };
  if (v === "fail")
    return { head: "Failed", tone: "bad", body: kind === "historical" ? "Skipping the ideas it scored below zero did worse than taking every idea. This version will not change trades." : "On new decisions, the filter did worse than taking every idea." };
  return {
    head: "Inconclusive",
    tone: "warn",
    body: kind === "historical"
      ? "It missed at least one pass mark (below). This version will not change trades."
      : "Not clearly better or worse yet. The next look follows.",
  };
}

/** Which preregistered pass marks a stored look missed, in plain words (empty when it passed). */
export function tmfMissed(r: { delta: { lo: number } | null; randomPercentile: number | null; keptNet: number; skipRate: number }, percentile: number): string[] {
  const out: string[] = [];
  const { min, max } = TM_FILTER_RULES.scoring.skipRate;
  if (!r.delta || r.delta.lo <= 0) out.push("It did not clearly beat taking every idea.");
  if (r.randomPercentile === null || r.randomPercentile < percentile)
    out.push(`Random skips of the same size did better: it beat only ${r.randomPercentile ?? 0}% of them (it needed ${percentile}%).`);
  if (r.keptNet <= 0) out.push("The ideas it kept still lost money after costs.");
  if (r.skipRate < min || r.skipRate > max) out.push(`It skipped ${Math.round(r.skipRate * 100)}% of ideas; the limit was ${min * 100}% to ${max * 100}%.`);
  return out;
}

export const tmfPassLine = () =>
  `To pass, the kept ideas had to beat taking every idea with 95% confidence, beat at least 95% of random skips of the same size, make money after costs, and skip between ${TM_FILTER_RULES.scoring.skipRate.min * 100}% and ${TM_FILTER_RULES.scoring.skipRate.max * 100}% of ideas.`;

export const tmfForwardLine = (calls: number, since: string | null) => {
  const [l1, l2] = TM_FILTER_RULES.forward.looks;
  return `${calls} new learner decision${calls === 1 ? "" : "s"} scored${since ? ` since ${since}` : ""}. The first look comes at ${l1.resolved} finished ideas over ${l1.sessions} trading days, the last at ${l2.resolved}. Each look is stored once.`;
};

export const TMF_EXPOSED =
  "These years were used by earlier research, so this is a check, not fresh evidence. The rule has nothing to tune and was not fitted on them.";

/** The filter's call on one trade, for the trade page. */
export function tmfCallLine(call: { ok: boolean; skip: boolean; edge_r: number | null; refusal: string | null }): string {
  if (!call.ok) return "Filter test: the time machine could not run at this decision, so the filter would have taken it.";
  const edge = call.edge_r === null ? "" : ` (average after costs ${call.edge_r >= 0 ? "+" : "−"}${Math.abs(call.edge_r).toFixed(2)} times the risk)`;
  return call.skip
    ? `Filter test: the filter would have skipped this idea${edge}. It is being tested; it does not change trades.`
    : `Filter test: the filter would have taken this idea${edge}. It is being tested; it does not change trades.`;
}
