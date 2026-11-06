/* Postgres storage for the AI second opinion, through the restricted aegis_ai
   role (AI_DATABASE_URL). Reads the learner's records; writes only the
   append-only ai_judge_calls and ai_looks rows and the one allowed study
   transition (waiting-for-model → active), all guarded again by triggers. */

import { stableHash } from "@/lib/experiment/hash";
import type { JudgeBar } from "./features";
import { sortForLooks, verdictFromLooks, type LookRowState, type StoredLook } from "./looks";
import { ABANDONED_CLAIM_SECONDS, MAX_ATTEMPTS, type JudgeDecisionRow, type JudgeStore, type JudgeStudyRow } from "./runner";
import { dueJudgeLook, runningJudge, type JudgeLookResult, type JudgeRunning, type JudgeScoreRow } from "./score";
import { JUDGE_STUDIES, judgeConfigHash, studyConfig } from "./studies";

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

/** One outcome's place in the looks: resolved, still open, or excluded
    (void, too large for one contract, or closed without a result). */
export function outcomeState(r: { outcome_status?: unknown; net?: unknown; standalone_qty?: unknown }): { state: LookRowState; net: number | null } {
  const qty = r.standalone_qty;
  if (r.outcome_status === "void" || (qty !== null && qty !== undefined && Number(qty) < 1)) return { state: "excluded", net: null };
  if (r.outcome_status === "closed") {
    const net = r.net === null || r.net === undefined ? NaN : Number(r.net);
    return Number.isFinite(net) ? { state: "resolved", net } : { state: "excluded", net: null };
  }
  return { state: "open", net: null };
}

/* Stored looks (ai_looks), shared with the AI research ideas. */
export async function readLooks(db: Db, kind: "judge" | "idea", subjectId: string): Promise<StoredLook[]> {
  const { rows } = await db.query(`SELECT look, verdict, taken_at FROM public.ai_looks WHERE subject_kind = $1 AND subject_id = $2 ORDER BY look`, [kind, subjectId]);
  return rows.flatMap((r) => (r.verdict === "pass" || r.verdict === "fail" || r.verdict === "inconclusive") && Number.isInteger(Number(r.look))
    ? [{ look: Number(r.look), verdict: r.verdict, takenAt: new Date(r.taken_at as string | Date).toISOString() }] : []);
}
export async function insertLook(db: Db, kind: "judge" | "idea", subjectId: string, look: { look: number; verdict: string; resolved: number; lastDecisionKey: string }, result: unknown, atMs: number): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO public.ai_looks (subject_kind, subject_id, look, taken_at, window_size, last_decision_key, verdict, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT DO NOTHING RETURNING look`,
    [kind, subjectId, look.look, iso(atMs), look.resolved, look.lastDecisionKey, look.verdict, JSON.stringify(result)]);
  return rows.length === 1;
}

export class PgJudgeStore implements JudgeStore {
  constructor(private readonly db: Db, private readonly nowMs: () => number = Date.now) {}

  async studies(): Promise<JudgeStudyRow[]> {
    const { rows } = await this.db.query(`SELECT id, status, extract(epoch FROM started_at)::float8 AS started, config_hash FROM public.ai_judge_studies ORDER BY id`);
    return rows.flatMap((r) =>
      typeof r.id === "string" && (r.status === "active" || r.status === "waiting-for-model") && typeof r.config_hash === "string"
        ? [{ id: r.id, status: r.status, startedAt: seconds(r.started), configHash: r.config_hash }] : []);
  }

  async pending(studyId: string, sinceSec: number, freshSinceSec: number, limit: number): Promise<JudgeDecisionRow[]> {
    // Filtered in SQL, so a stuck decision can never hold up the queue:
    // finished ones, ones out of attempts, and ones with an attempt still in
    // progress (a recent claim with neither an answer nor an error) are left out.
    const nowSec = Math.floor(this.nowMs() / 1000);
    const { rows } = await this.db.query(
      `SELECT d.decision_key, d.symbol, d.side, d.session_key, extract(epoch FROM d.info_cutoff)::float8 AS cutoff,
         extract(epoch FROM d.created_at)::float8 AS created, d.idea, d.features, coalesce(c.attempts, 0) AS attempts
       FROM public.experiment_decisions d
       JOIN public.experiments e ON e.id = d.experiment_id
       LEFT JOIN LATERAL (SELECT count(*)::int AS attempts, max(occurred_at) AS last_claim FROM public.ai_judge_calls
         WHERE study_id = $1 AND decision_key = d.decision_key AND kind = 'claim') c ON true
       WHERE e.lineage = 'learner' AND e.status = 'active'
         AND d.created_at >= to_timestamp($2) AND d.created_at >= to_timestamp($3)
         AND NOT EXISTS (SELECT 1 FROM public.ai_judge_calls f WHERE f.study_id = $1 AND f.decision_key = d.decision_key AND f.kind IN ('decision', 'invalid'))
         AND coalesce(c.attempts, 0) < $5
         AND NOT (c.last_claim IS NOT NULL AND c.last_claim > to_timestamp($6)
           AND NOT EXISTS (SELECT 1 FROM public.ai_judge_calls x WHERE x.study_id = $1 AND x.decision_key = d.decision_key AND x.kind = 'error' AND x.occurred_at >= c.last_claim))
       ORDER BY d.created_at, d.decision_key
       LIMIT $4`,
      [studyId, sinceSec, freshSinceSec, limit, MAX_ATTEMPTS, nowSec - ABANDONED_CLAIM_SECONDS]);
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

  async scoreRows(studyId: string): Promise<JudgeScoreRow[]> {
    const { rows } = await this.db.query(
      `SELECT c.decision_key, c.payload->'verdict'->>'decision' AS decision, d.session_key,
         extract(epoch FROM d.created_at)::float8 AS created, o.outcome_status, o.net, o.standalone_qty
       FROM public.ai_judge_calls c
       JOIN public.experiment_decisions d ON d.decision_key = c.decision_key
       LEFT JOIN public.experiment_outcomes o ON o.decision_key = c.decision_key
       WHERE c.study_id = $1 AND c.kind = 'decision'`, [studyId]);
    return sortForLooks(rows.flatMap((r) => {
      const created = seconds(r.created);
      if (typeof r.decision_key !== "string" || created === null || (r.decision !== "take" && r.decision !== "skip")) return [];
      return [{ key: r.decision_key, session: String(r.session_key), order: created, decision: r.decision, ...outcomeState(r) }];
    }));
  }

  looks(studyId: string): Promise<StoredLook[]> {
    return readLooks(this.db, "judge", studyId);
  }

  saveLook(studyId: string, result: JudgeLookResult, atMs: number): Promise<boolean> {
    return insertLook(this.db, "judge", studyId, result, result, atMs);
  }
}

export interface ScoreboardStudy extends JudgeRunning {
  id: string;
  label: string;
  model: string;
  status: "active" | "waiting-for-model";
  startedAt: string | null;
  verdict: "too-early" | "inconclusive" | "pass" | "fail";
  nextLook: number | null;
  /** Why the next look is not taken yet, in plain words, or null. */
  waiting: string | null;
}

/** Numbers only (no AI text): safe for the public scoreboard. The verdict is
    read from the stored looks, never recomputed here. */
export async function readScoreboard(db: Db, nowMs: number = Date.now()): Promise<ScoreboardStudy[]> {
  const store = new PgJudgeStore(db, () => nowMs);
  const studies = await db.query(`SELECT id, status, started_at, config_hash FROM public.ai_judge_studies ORDER BY id`);
  const order = new Map(JUDGE_STUDIES.map((s, i) => [s.id, i]));
  const out: ScoreboardStudy[] = [];
  for (const s of [...studies.rows].sort((a, b) => (order.get(String(a.id)) ?? 99) - (order.get(String(b.id)) ?? 99))) {
    const config = typeof s.id === "string" ? studyConfig(s.id) : null;
    // Only registrations that match the frozen code are shown, as only they run.
    if (!config || s.config_hash !== judgeConfigHash(config) || (s.status !== "active" && s.status !== "waiting-for-model")) continue;
    const [rows, stored] = await Promise.all([store.scoreRows(config.id), store.looks(config.id)]);
    const { verdict, nextLook } = verdictFromLooks(stored, config.rules.looks.map((l) => l.resolved));
    const due = dueJudgeLook(rows, stored, config.id, config.rules, Math.floor(nowMs / 1000), config.rules.freshnessSeconds);
    const waiting = "due" in due ? `Look ${due.due.look} is complete and will be recorded at the next pass.` : due.waiting;
    out.push({
      id: config.id, label: config.label, model: config.model, status: s.status, startedAt: s.started_at ? new Date(s.started_at as string | Date).toISOString() : null,
      ...runningJudge(rows, config.id, config.rules), verdict, nextLook, waiting,
    });
  }
  return out;
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
