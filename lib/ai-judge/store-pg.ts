/* Postgres storage for the AI second opinion, through the restricted aegis_ai
   role (AI_DATABASE_URL). Reads the learner's records; writes only the
   append-only ai_judge_calls rows and the one allowed study transition
   (waiting-for-model → active), both guarded again by database triggers. */

import { stableHash } from "@/lib/experiment/hash";
import type { JudgeBar } from "./features";
import type { JudgeDecisionRow, JudgeStore, JudgeStudyRow } from "./runner";
import { scoreJudge, type JudgeScore, type JudgeScoreRow } from "./score";
import { judgeConfigHash, studyConfig } from "./studies";

export interface Db {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

const seconds = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
};
const iso = (ms: number) => new Date(ms).toISOString();
const keyOf = (...parts: (string | number)[]) => stableHash(parts).slice(0, 40);

export class PgJudgeStore implements JudgeStore {
  constructor(private readonly db: Db) {}

  async studies(): Promise<JudgeStudyRow[]> {
    const { rows } = await this.db.query(
      `SELECT id, status, extract(epoch FROM started_at)::float8 AS started, config_hash FROM public.ai_judge_studies ORDER BY registered_at, id`);
    return rows.flatMap((r) =>
      typeof r.id === "string" && (r.status === "active" || r.status === "waiting-for-model") && typeof r.config_hash === "string"
        ? [{ id: r.id, status: r.status, startedAt: seconds(r.started), configHash: r.config_hash }] : []);
  }

  async pending(studyId: string, sinceSec: number, freshSinceSec: number, limit: number): Promise<JudgeDecisionRow[]> {
    const { rows } = await this.db.query(
      `SELECT d.decision_key, d.symbol, d.side, d.session_key, extract(epoch FROM d.info_cutoff)::float8 AS cutoff,
         extract(epoch FROM d.created_at)::float8 AS created, d.idea, d.features,
         (SELECT count(*) FROM public.ai_judge_calls c WHERE c.study_id = $1 AND c.decision_key = d.decision_key AND c.kind = 'claim')::int AS attempts
       FROM public.experiment_decisions d
       JOIN public.experiments e ON e.id = d.experiment_id
       WHERE e.lineage = 'learner' AND e.status = 'active'
         AND d.created_at >= to_timestamp($2) AND d.created_at >= to_timestamp($3)
         AND NOT EXISTS (SELECT 1 FROM public.ai_judge_calls c WHERE c.study_id = $1 AND c.decision_key = d.decision_key AND c.kind IN ('decision','invalid'))
       ORDER BY d.created_at, d.decision_key
       LIMIT $4`,
      [studyId, sinceSec, freshSinceSec, limit]);
    return rows.flatMap((r) => {
      const cutoff = seconds(r.cutoff), created = seconds(r.created);
      if (typeof r.decision_key !== "string" || cutoff === null || created === null) return [];
      return [{
        decisionKey: r.decision_key, symbol: String(r.symbol), side: String(r.side), sessionKey: String(r.session_key),
        infoCutoff: cutoff, createdAt: created, idea: (r.idea as Record<string, unknown>) ?? null,
        features: (r.features as Record<string, unknown>) ?? null, attempts: Number(r.attempts) || 0,
      }];
    });
  }

  async bars(symbol: string, fromSec: number, cutoffSec: number): Promise<JudgeBar[]> {
    // The bar END must be at or before the cutoff; marketContext checks again.
    const { rows } = await this.db.query(
      `SELECT time, open, high, low, close FROM public.bars_5m
       WHERE symbol = $1 AND source = 'yahoo' AND time >= $2 AND time + 300 <= $3
       ORDER BY time LIMIT 2000`, [symbol, fromSec, cutoffSec]);
    return rows.map((r) => ({ time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close) }));
  }

  async claim(studyId: string, decisionKey: string, attempt: number, atMs: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_judge_calls (event_key, study_id, decision_key, kind, occurred_at, payload)
       VALUES ($1, $2, $3, 'claim', $4, $5::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [`claim:${keyOf(studyId, decisionKey, attempt)}`, studyId, decisionKey, iso(atMs), JSON.stringify({ attempt })]);
    return rows.length === 1;
  }

  async record(studyId: string, decisionKey: string, kind: "decision" | "invalid" | "error", attempt: number, atMs: number, payload: Record<string, unknown>): Promise<boolean> {
    // decision/invalid share one key per study and decision: the first answer wins.
    const eventKey = kind === "error" ? `error:${keyOf(studyId, decisionKey, attempt)}` : `final:${keyOf(studyId, decisionKey)}`;
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_judge_calls (event_key, study_id, decision_key, kind, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [eventKey, studyId, decisionKey, kind, iso(atMs), JSON.stringify(payload)]);
    return rows.length === 1;
  }

  async claimProbe(studyId: string, windowStartMs: number, atMs: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_judge_calls (event_key, study_id, decision_key, kind, occurred_at, payload)
       VALUES ($1, $2, 'probe', 'probe', $3, $4::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [`probe:${keyOf(studyId, windowStartMs)}`, studyId, iso(atMs), JSON.stringify({ window: iso(windowStartMs) })]);
    return rows.length === 1;
  }

  async recordProbe(studyId: string, windowStartMs: number, atMs: number, payload: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO public.ai_judge_calls (event_key, study_id, decision_key, kind, occurred_at, payload)
       VALUES ($1, $2, 'probe', 'probe', $3, $4::jsonb) ON CONFLICT (event_key) DO NOTHING`,
      [`probe-result:${keyOf(studyId, windowStartMs)}`, studyId, iso(atMs), JSON.stringify(payload)]);
  }

  async activate(studyId: string, atMs: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `UPDATE public.ai_judge_studies SET status = 'active', started_at = $2
       WHERE id = $1 AND status = 'waiting-for-model' AND started_at IS NULL RETURNING id`, [studyId, iso(atMs)]);
    return rows.length === 1;
  }
}

export interface ScoreboardStudy extends JudgeScore {
  id: string;
  label: string;
  model: string;
  status: "active" | "waiting-for-model";
  startedAt: string | null;
}

/** Numbers only (no AI text): safe for the public scoreboard. */
export async function readScoreboard(db: Db): Promise<ScoreboardStudy[]> {
  const studies = await db.query(`SELECT id, status, started_at, config_hash FROM public.ai_judge_studies ORDER BY registered_at, id`);
  const calls = await db.query(
    `SELECT c.study_id, c.decision_key, c.payload->'verdict'->>'decision' AS decision, d.session_key,
       extract(epoch FROM d.decided_at)::float8 AS at, o.outcome_status, o.status AS sim_status, o.net, o.standalone_qty
     FROM public.ai_judge_calls c
     JOIN public.experiment_decisions d ON d.decision_key = c.decision_key
     LEFT JOIN public.experiment_outcomes o ON o.decision_key = c.decision_key
     WHERE c.kind = 'decision'`);
  const byStudy = new Map<string, JudgeScoreRow[]>();
  for (const r of calls.rows) {
    if (typeof r.study_id !== "string" || typeof r.decision_key !== "string" || (r.decision !== "take" && r.decision !== "skip")) continue;
    // Preregistered exclusions: void outcomes, and ideas the account could not
    // take even one contract of. Pending/open outcomes stay unresolved.
    if (r.outcome_status === "void" || (r.standalone_qty !== null && r.standalone_qty !== undefined && Number(r.standalone_qty) < 1)) continue;
    const net = r.outcome_status === "closed" ? (r.sim_status === "cancelled" ? 0 : r.net === null ? null : Number(r.net)) : null;
    const row: JudgeScoreRow = { key: r.decision_key, session: String(r.session_key), at: Number(r.at) || 0, decision: r.decision, net: net !== null && Number.isFinite(net) ? net : null };
    byStudy.set(r.study_id, [...(byStudy.get(r.study_id) ?? []), row]);
  }
  return studies.rows.flatMap((s) => {
    const config = typeof s.id === "string" ? studyConfig(s.id) : null;
    // Only registrations that match the frozen code are shown, as only they run.
    if (!config || s.config_hash !== judgeConfigHash(config) || (s.status !== "active" && s.status !== "waiting-for-model")) return [];
    const startedAt = s.started_at ? new Date(s.started_at as string | Date).toISOString() : null;
    return [{ id: config.id, label: config.label, model: config.model, status: s.status, startedAt, ...scoreJudge(byStudy.get(config.id) ?? [], config.id, config.rules) }];
  });
}

export interface OwnerCall {
  decisionKey: string;
  studyId: string;
  model: string;
  decision: "take" | "skip";
  confidence: number;
  reason: string;
  calledAt: string;
}

export async function readOwnerCalls(db: Db, limit = 300): Promise<OwnerCall[]> {
  const { rows } = await db.query(
    `SELECT decision_key, study_id, payload, occurred_at FROM public.ai_judge_calls WHERE kind = 'decision' ORDER BY occurred_at DESC LIMIT $1`, [limit]);
  return rows.flatMap((r) => {
    const p = (r.payload ?? {}) as { model?: unknown; verdict?: { decision?: unknown; confidence?: unknown; reason?: unknown } };
    const v = p.verdict;
    if (typeof r.decision_key !== "string" || typeof r.study_id !== "string" || !v || (v.decision !== "take" && v.decision !== "skip") ||
        typeof v.confidence !== "number" || typeof v.reason !== "string") return [];
    const at = r.occurred_at instanceof Date ? r.occurred_at.toISOString() : new Date(String(r.occurred_at)).toISOString();
    return [{ decisionKey: r.decision_key, studyId: r.study_id, model: typeof p.model === "string" ? p.model : "", decision: v.decision, confidence: v.confidence, reason: v.reason, calledAt: at }];
  });
}
