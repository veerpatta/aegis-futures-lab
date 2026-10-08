/* Explain the existing dataset filters without changing any training evidence.
   Counts belong to the recorded check's cutoff, not the phone's current time. */
import type { EvalRow } from "./evaluate";
import type { Decision, Outcome } from "./types";

export interface LearningAudit {
  checked: number;
  usable: number;
  fromTaken: number;
  fromSkipped: number;
  sessions: number;
  prospective: number;
  replay: number;
  synthetic: number;
  late: number;
  awaiting: number;
  noFill: number;
  tooRisky: number;
  missingFeatures: number;
  duplicate: number;
  afterCutoff: number;
  ambiguous: number;
}

export function auditLearningData(decisions: Decision[], outcomes: Outcome[], rows: EvalRow[], cutoff: number): LearningAudit {
  const eligible = new Set(rows.map(r => r.key));
  const byKey = new Map(outcomes.map(o => [o.decisionKey, o]));
  const audit: LearningAudit = {
    checked: decisions.length, usable: rows.length, fromTaken: 0, fromSkipped: 0,
    sessions: new Set(rows.map(r => r.session)).size,
    prospective: 0, replay: 0, synthetic: 0, late: 0, awaiting: 0, noFill: 0,
    tooRisky: 0, missingFeatures: 0, duplicate: 0, afterCutoff: 0, ambiguous: 0,
  };
  for (const r of rows) audit[r.provenance]++;
  for (const d of decisions) {
    const o = byKey.get(d.key);
    if (eligible.has(d.key)) {
      if (d.action === "take") audit.fromTaken++; else audit.fromSkipped++;
      if (o?.sim.ambiguous) audit.ambiguous++;
    } else if (!o || (o.status !== "closed" && o.status !== "void")) audit.awaiting++;
    else if (o.status === "void") audit.noFill++;
    else if (!d.features) audit.missingFeatures++;
    else if (o.standaloneQty < 1) audit.tooRisky++;
    else if (o.sim.net === null || o.sim.exitTs === null) audit.awaiting++;
    else if (o.sim.exitTs > cutoff) audit.afterCutoff++;
    else audit.duplicate++;
  }
  return audit;
}
