/* From replay examples to an immutable, accounted-for study dataset. Pure.

   Every example is either an eligible training/evaluation row or counted
   under exactly one exclusion. Opportunity families keep every copy of the
   same idea together (count each economic outcome once). Splits are by
   trading session, chronological, fixed from the session list before any
   outcome is read. Fold reports show training rows, purged rows, test rows
   and unique sessions — a total alone never stands in for valid folds. */

import { pastEmbargo } from "@/scripts/engine/winprob";
import type { EvalRow } from "@/lib/experiment/evaluate";
import { stableHash } from "@/lib/experiment/hash";
import { HIST_RULES } from "./rules";
import { sessionOf, type ReplayExample, type ReplayMode } from "./replay";

export type Exclusion =
  | "other-mode" | "duplicate-family" | "structural-void" | "over-risk" | "quarantined" | "label-not-ready" | "no-features";

export interface RowExtra {
  fillTs: number | null;
  exitTs: number;
  riskPc: number | null;
}

export interface StudyDataset {
  mode: ReplayMode;
  rows: EvalRow[];
  extras: Map<string, RowExtra>;
  exclusions: Record<Exclusion, number>;
  rawExamples: number;
  families: number;
  sessions: string[];
  byStrategy: Record<string, number>;
  bySymbol: Record<string, number>;
  rowsHash: string;
}

export function buildStudyDataset(examples: ReplayExample[], cutoff: number, mode: ReplayMode = HIST_RULES.primaryMode): StudyDataset {
  const exclusions: Record<Exclusion, number> = {
    "other-mode": 0, "duplicate-family": 0, "structural-void": 0, "over-risk": 0, quarantined: 0, "label-not-ready": 0, "no-features": 0,
  };
  const seen = new Set<string>();
  const rows: EvalRow[] = [];
  const extras = new Map<string, RowExtra>();
  const byStrategy: Record<string, number> = {}, bySymbol: Record<string, number> = {};
  const sorted = [...examples].sort((a, b) => a.decidedAt - b.decidedAt || a.familyId.localeCompare(b.familyId));
  for (const e of sorted) {
    if (e.mode !== mode) { exclusions["other-mode"]++; continue; }
    if (seen.has(e.familyId)) { exclusions["duplicate-family"]++; continue; }
    seen.add(e.familyId);
    if (e.outcomeStatus === "void" && e.reason === "risk-budget") { exclusions["over-risk"]++; continue; }
    if (e.outcomeStatus === "void") { exclusions["structural-void"]++; continue; }
    if (e.standaloneQty < 1) { exclusions["over-risk"]++; continue; }
    if (e.quarantined) { exclusions.quarantined++; continue; }
    if (e.outcomeStatus !== "closed" || e.exitTs === null || e.netPc === null || e.labelReadyAt === null || e.labelReadyAt > cutoff) { exclusions["label-not-ready"]++; continue; }
    if (!e.features) { exclusions["no-features"]++; continue; }
    const friction = (e.feesPc ?? 0) + (e.slipPc ?? 0);
    rows.push({
      key: `${mode}:${e.familyId}`, session: sessionOf(e.signalTs), decidedAt: e.decidedAt, exitTs: e.exitTs, features: e.features,
      win: e.netPc > 0 ? 1 : 0, net: Math.round(e.standaloneQty * e.netPc * 100) / 100, netPerContract: e.netPc,
      frictionPerContract: friction, standaloneQty: e.standaloneQty, provenance: "replay",
    });
    extras.set(`${mode}:${e.familyId}`, { fillTs: e.fillTs, exitTs: e.exitTs, riskPc: e.riskPc });
    byStrategy[e.strategy] = (byStrategy[e.strategy] ?? 0) + 1;
    bySymbol[e.symbol] = (bySymbol[e.symbol] ?? 0) + 1;
  }
  const sessions = [...new Set(rows.map((r) => r.session))].sort();
  return {
    mode, rows, extras, exclusions, rawExamples: examples.length, families: seen.size, sessions, byStrategy, bySymbol,
    rowsHash: stableHash(rows.map((r) => ({ k: r.key, n: r.net, w: r.win, d: r.decidedAt }))),
  };
}

export interface Split {
  development: { from: string; to: string; sessions: number; rows: number };
  validation: { from: string; to: string; sessions: number; rows: number };
  final: { from: string; to: string; sessions: number; rows: number };
}

/** Chronological 60/20/20 by eligible session. Sessions, not rows, so a day's ideas never straddle a boundary. */
export function splitSessions(ds: StudyDataset, rules = HIST_RULES): Split | null {
  const s = ds.sessions;
  if (s.length < 10) return null;
  const devEnd = Math.floor(s.length * rules.split.development);
  const valEnd = Math.floor(s.length * (rules.split.development + rules.split.validation));
  const part = (a: number, b: number) => {
    const set = new Set(s.slice(a, b));
    return { from: s[a], to: s[b - 1], sessions: b - a, rows: ds.rows.filter((r) => set.has(r.session)).length };
  };
  return { development: part(0, devEnd), validation: part(devEnd, valEnd), final: part(valEnd, s.length) };
}

export function rowsIn(rows: EvalRow[], period: { from: string; to: string }): EvalRow[] {
  return rows.filter((r) => r.session >= period.from && r.session <= period.to);
}

/** Training rows for a test period starting at `testStart`: earlier sessions only, past the exit-time embargo. */
export function trainingFor(rows: EvalRow[], testFirstSession: string, testStart: number, windowSessions: number | null): { train: EvalRow[]; purged: number } {
  const before = rows.filter((r) => r.session < testFirstSession);
  const kept = before.filter((r) => pastEmbargo(r.exitTs, testStart));
  if (windowSessions === null) return { train: kept, purged: before.length - kept.length };
  const keep = new Set([...new Set(kept.map((r) => r.session))].sort().slice(-windowSessions));
  return { train: kept.filter((r) => keep.has(r.session)), purged: before.length - kept.length };
}

export interface FoldReport {
  fold: number;
  trainRows: number;
  purgedRows: number;
  testRows: number;
  trainSessions: number;
  testSessions: number;
  testFrom: string;
  testTo: string;
  valid: boolean;
}

/** The five expanding development folds, with the preregistered coverage verdict. */
export function foldReport(devRows: EvalRow[], windowSessions: number | null, rules = HIST_RULES): { folds: FoldReport[]; coverage: boolean; reason: string | null } {
  const sessions = [...new Set(devRows.map((r) => r.session))].sort();
  const n = rules.folds.count;
  const size = Math.floor(sessions.length / (n + 1));
  const folds: FoldReport[] = [];
  for (let f = 1; f <= n; f++) {
    const testSessions = size >= 1 ? sessions.slice(f * size, f === n ? undefined : (f + 1) * size) : [];
    const set = new Set(testSessions);
    const test = devRows.filter((r) => set.has(r.session));
    const testStart = test.length ? Math.min(...test.map((r) => r.decidedAt)) : Infinity;
    const { train, purged } = test.length ? trainingFor(devRows, testSessions[0], testStart, windowSessions) : { train: [], purged: 0 };
    folds.push({
      fold: f, trainRows: train.length, purgedRows: purged, testRows: test.length, trainSessions: new Set(train.map((r) => r.session)).size,
      testSessions: testSessions.length, testFrom: testSessions[0] ?? "", testTo: testSessions.at(-1) ?? "",
      valid: train.length >= rules.folds.minTrainRows && test.length >= rules.folds.minTestRows,
    });
  }
  const bad = folds.filter((f) => !f.valid);
  return {
    folds, coverage: bad.length === 0,
    reason: bad.length ? `fold ${bad.map((f) => f.fold).join(", ")} below ${rules.folds.minTrainRows} training or ${rules.folds.minTestRows} test rows` : null,
  };
}
