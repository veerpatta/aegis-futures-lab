/* Turning the experiment's own closed outcomes into a versioned dataset, and
   the bookkeeping the weekly review needs. Pure.

   Only outcomes that CLOSED before the cutoff enter, each decision once, with
   its frozen features and the same net-cost arithmetic. Void outcomes (no
   definable fill) and rows without frozen features never enter. Provenance is
   carried on every row so late catch-up, replay and synthetic evidence are
   never mixed with prospective evidence by accident. */

import { tradingDayKey } from "@/lib/time/ny";
import { pointValue } from "./policy";
import { stableHash } from "./hash";
import { EXP_FEATURE_VERSION } from "./features";
import type { EvalRow, FreshWindow } from "./evaluate";
import type { DatasetRecord, ShadowScoreRecord } from "./store";
import type { Decision, Outcome } from "./types";

export function buildEvalRows(decisions: Decision[], outcomes: Outcome[], cutoff: number): EvalRow[] {
  const byKey = new Map(outcomes.map((o) => [o.decisionKey, o]));
  const seen = new Set<string>();
  const rows: EvalRow[] = [];
  for (const d of [...decisions].sort((a, b) => a.decidedAt - b.decidedAt || a.key.localeCompare(b.key))) {
    if (seen.has(d.opportunityKey)) continue;
    const o = byKey.get(d.key);
    if (!o || o.status !== "closed" || !d.features || o.standaloneQty < 1) continue;
    const s = o.sim;
    if (s.net === null || s.exitTs === null || s.exitTs > cutoff) continue;
    seen.add(d.opportunityKey);
    const slipDollars = ((s.entrySlip ?? 0) + (s.exitSlip ?? 0)) * pointValue(s.symbol);
    rows.push({
      key: d.key, session: d.sessionKey, decidedAt: d.decidedAt, exitTs: s.exitTs, features: d.features,
      win: s.net > 0 ? 1 : 0, net: Math.round(o.standaloneQty * s.net * 100) / 100, netPerContract: s.net,
      frictionPerContract: (s.fees ?? 0) + slipDollars, standaloneQty: o.standaloneQty, provenance: d.provenance,
    });
  }
  return rows;
}

export function datasetFor(experimentId: string, rows: EvalRow[], cutoff: number): DatasetRecord {
  const ordered = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  const byProvenance: Record<string, number> = {};
  for (const r of rows) byProvenance[r.provenance] = (byProvenance[r.provenance] ?? 0) + 1;
  return {
    id: `${experimentId}:${tradingDayKey(cutoff)}:${stableHash(ordered.map((r) => r.key)).slice(0, 8)}`,
    cutoff, featureVersion: EXP_FEATURE_VERSION, rowCount: rows.length, decisionKeys: ordered.map((r) => r.key),
    rowsHash: stableHash(ordered.map((r) => ({ k: r.key, n: r.net, w: r.win, p: r.provenance }))),
    filters: { closedBefore: new Date(cutoff * 1000).toISOString(), excludes: ["void", "no-features", "zero-standalone-qty"], dedupe: "opportunity_key" },
    stats: { byProvenance, sessions: new Set(rows.map((r) => r.session)).size, net: Math.round(rows.reduce((a, r) => a + r.net, 0) * 100) / 100 },
  };
}

/** Did the model behind a decision want the trade (before risk limits)? */
export function modelWanted(d: Pick<Decision, "pWin" | "threshold">): boolean {
  return d.threshold === null || d.threshold === undefined ? true : (d.pWin ?? 0) >= d.threshold;
}

/** The challenger's fresh confirmation window: prospective ideas decided after
    it was registered, scored live while it shadowed, now closed. */
export function freshWindow(
  versionId: string, registeredAt: number, decisions: Decision[], rows: EvalRow[], scores: ShadowScoreRecord[], allowSynthetic = false,
): FreshWindow & { rows: { session: string; delta: number; net: number }[] } {
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const scoreByKey = new Map(scores.filter((s) => s.versionId === versionId).map((s) => [s.decisionKey, s]));
  const out: { session: string; delta: number; net: number }[] = [];
  for (const d of decisions) {
    if (d.decidedAt <= registeredAt) continue;
    if (!(d.provenance === "prospective" || (allowSynthetic && d.provenance === "synthetic"))) continue;
    const r = rowByKey.get(d.key), s = scoreByKey.get(d.key);
    if (!r || !s) continue;
    const c = s.wouldTake ? r.net : 0, inc = modelWanted(d) ? r.net : 0;
    out.push({ session: r.session, delta: c - inc, net: c });
  }
  const n = out.length;
  return {
    sessions: new Set(out.map((r) => r.session)).size,
    decisions: n,
    deltaPerIdea: n ? out.reduce((a, r) => a + r.delta, 0) / n : 0,
    netPerIdea: n ? out.reduce((a, r) => a + r.net, 0) / n : 0,
    rows: out,
  };
}

/** Rows decided by the active model since it took over, matched against the
    take-every-idea control (computable because every decision has a shadow). */
export function postAdoptionRows(versionId: string, since: number, decisions: Decision[], rows: EvalRow[], allowSynthetic = false) {
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  return decisions
    .filter((d) => d.modelVersionId === versionId && d.decidedAt > since && (d.provenance === "prospective" || (allowSynthetic && d.provenance === "synthetic")))
    .map((d) => ({ d, r: rowByKey.get(d.key) }))
    .filter((x): x is { d: Decision; r: EvalRow } => !!x.r)
    .map(({ d, r }) => {
      const took = modelWanted(d);
      return { session: r.session, delta: (took ? r.net : 0) - r.net, net: took ? r.net : 0, p: d.pWin, y: r.win };
    });
}

/** ISO week of the New York trading day, e.g. "2026-W41". */
export function weekKeyOf(nowSec: number): string {
  const [y, m, d] = tradingDayKey(nowSec).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
