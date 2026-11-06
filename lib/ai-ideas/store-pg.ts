/* Postgres storage for AI research ideas through the restricted aegis_ai role.
   Reads the learner's records; writes only ai_hypotheses rows (write-once,
   except the single testing → retired change a trigger allows), stored looks
   and week notes. */

import { insertLook, outcomeState, readLooks, type Db } from "@/lib/ai-judge/store-pg";
import { verdictFromLooks, type StoredLook } from "@/lib/ai-judge/looks";
import { PgCoachStore } from "@/lib/ai-coach/store-pg";
import type { CoachNote } from "@/lib/ai-coach/runner";
import { cleanText } from "@/lib/ai-free/text";
import { decisionFields, parseRule, ruleHash, type Rule } from "./dsl";
import type { FinishedDecision } from "./facts";
import { ruleRows, type HypothesisRow, type IdeasStore, type PopulationRow } from "./runner";
import { IDEAS_RULES } from "./rules";
import { dueIdeaLook, runningIdea, type IdeaLookResult, type IdeaRunning } from "./score";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DECISION_COLS = `d.decision_key, d.session_key, extract(epoch FROM d.decided_at)::float8 AS decided, extract(epoch FROM d.created_at)::float8 AS created,
  d.symbol, d.side, d.est_risk, d.idea, d.features`;

function fieldsOf(r: Record<string, unknown>, decided: number) {
  return decisionFields({ symbol: r.symbol, side: r.side, decidedAt: decided, estRisk: r.est_risk, idea: (r.idea as Record<string, unknown>) ?? null, features: (r.features as Record<string, unknown>) ?? null });
}

export class PgIdeasStore implements IdeasStore {
  constructor(private readonly db: Db) {}

  async hypotheses(): Promise<HypothesisRow[]> {
    const { rows } = await this.db.query(
      `SELECT id, extract(epoch FROM proposed_at)::float8 AS proposed, model, prompt_version, rule, rule_hash, status,
         extract(epoch FROM retired_at)::float8 AS retired, retire_reason
       FROM public.ai_hypotheses ORDER BY proposed_at DESC, id`);
    return rows.flatMap((r) => {
      const parsed = parseRule(r.rule);
      const proposed = num(r.proposed);
      // A stored rule that no longer parses, or whose logic changed, is not scored.
      if (!parsed.ok || proposed === null || typeof r.id !== "string" || r.rule_hash !== ruleHash(parsed.rule) || (r.status !== "testing" && r.status !== "retired")) return [];
      const retired = num(r.retired);
      return [{ id: r.id, proposedAt: Math.floor(proposed), model: String(r.model ?? ""), promptVersion: String(r.prompt_version ?? ""), rule: parsed.rule,
        ruleHash: String(r.rule_hash), status: r.status, retiredAt: retired === null ? null : Math.floor(retired), retireReason: (r.retire_reason as string) ?? null }];
    });
  }

  async lastProposalAt(): Promise<number | null> {
    const { rows } = await this.db.query(
      `SELECT extract(epoch FROM greatest((SELECT max(proposed_at) FROM public.ai_hypotheses),
         (SELECT max(created_at) FROM public.ai_notes WHERE kind = 'week')))::float8 AS last`);
    const last = num(rows[0]?.last);
    return last === null ? null : Math.floor(last);
  }

  async finished(): Promise<FinishedDecision[]> {
    // Every learner campaign's finished ideas, one per opportunity (the latest
    // campaign's decision when two campaigns saw the same idea). Void outcomes
    // carry no result; ideas too large for one contract are kept here, as
    // facts for the AI, though the tests exclude them.
    const { rows } = await this.db.query(
      `SELECT DISTINCT ON (d.opportunity_key) ${DECISION_COLS}, o.outcome_status, o.net
       FROM public.experiment_decisions d
       JOIN public.experiments e ON e.id = d.experiment_id
       JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key
       WHERE e.lineage = 'learner' AND o.outcome_status = 'closed' AND o.net IS NOT NULL
       ORDER BY d.opportunity_key, e.campaign DESC, d.decided_at DESC`);
    return rows.flatMap((r) => {
      const decided = num(r.decided), net = num(r.net);
      if (typeof r.decision_key !== "string" || decided === null || net === null) return [];
      return [{ key: r.decision_key, session: String(r.session_key), fields: fieldsOf(r, decided), net }];
    });
  }

  async population(sinceSec: number, untilSec: number | null): Promise<PopulationRow[]> {
    // Only the active campaign records decisions, so "recorded after the rule
    // was proposed" is the active campaign's decisions; a later campaign change
    // does not rewrite a finished test.
    const { rows } = await this.db.query(
      `SELECT ${DECISION_COLS}, o.outcome_status, o.net, o.standalone_qty
       FROM public.experiment_decisions d
       JOIN public.experiments e ON e.id = d.experiment_id
       LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key
       WHERE e.lineage = 'learner' AND d.created_at > to_timestamp($1) AND ($2::float8 IS NULL OR d.created_at <= to_timestamp($2))
       ORDER BY d.created_at, d.decision_key`, [sinceSec, untilSec]);
    return rows.flatMap((r) => {
      const decided = num(r.decided), created = num(r.created);
      if (typeof r.decision_key !== "string" || decided === null || created === null) return [];
      // Preregistered exclusions as for the second opinion: void outcomes and
      // ideas too large for one contract are "excluded", never resolved.
      return [{ key: r.decision_key, session: String(r.session_key), order: created, fields: fieldsOf(r, decided), ...outcomeState(r) }];
    });
  }

  looks(ruleId: string): Promise<StoredLook[]> {
    return readLooks(this.db, "idea", ruleId);
  }

  saveLook(ruleId: string, result: IdeaLookResult, atMs: number): Promise<boolean> {
    return insertLook(this.db, "idea", ruleId, result, result, atMs);
  }

  async insert(h: { id: string; proposedAtMs: number; model: string; promptVersion: string; rule: Rule; ruleHash: string }): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_hypotheses (id, proposed_at, model, prompt_version, rule, rule_hash, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'testing') ON CONFLICT DO NOTHING RETURNING id`,
      [h.id, new Date(h.proposedAtMs).toISOString(), h.model, h.promptVersion,
        JSON.stringify({ ...h.rule, name: cleanText(h.rule.name, 60), why: cleanText(h.rule.why, 300) }), h.ruleHash]);
    return rows.length === 1;
  }

  async retire(id: string, atMs: number, reason: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `UPDATE public.ai_hypotheses SET status = 'retired', retired_at = $2, retire_reason = $3
       WHERE id = $1 AND status = 'testing' RETURNING id`, [id, new Date(atMs).toISOString(), cleanText(reason, 200)]);
    return rows.length === 1;
  }

  saveWeekNote(note: CoachNote, atMs: number): Promise<boolean> {
    return new PgCoachStore(this.db).save(note, atMs);
  }
}

export interface ScoreboardIdea extends IdeaRunning {
  id: string;
  proposedAt: string;
  model: string;
  status: "testing" | "retired";
  verdict: "too-early" | "inconclusive" | "pass" | "fail";
  nextLook: number | null;
  /** Why the next look is not taken yet, in plain words, or null. */
  waiting: string | null;
}

/** Numbers only (no rule text): safe for the public scoreboard. The verdict is
    read from the stored looks, never recomputed here. */
export async function readIdeasScoreboard(db: Db, nowMs: number = Date.now(), limit = 50): Promise<ScoreboardIdea[]> {
  const store = new PgIdeasStore(db);
  const out: ScoreboardIdea[] = [];
  for (const h of (await store.hypotheses()).slice(0, limit)) {
    const [rows, stored] = await Promise.all([ruleRows(store, h), store.looks(h.id)]);
    const { verdict, nextLook } = verdictFromLooks(stored, IDEAS_RULES.looks.map((l) => l.resolved));
    const due = h.status === "testing" ? dueIdeaLook(rows, stored, h.id, IDEAS_RULES, Math.floor(nowMs / 1000)) : { waiting: null };
    const waiting = "due" in due ? `Look ${due.due.look} is complete and will be recorded at the next pass.` : due.waiting;
    out.push({ id: h.id, proposedAt: new Date(h.proposedAt * 1000).toISOString(), model: h.model, status: h.status, ...runningIdea(rows, h.id, IDEAS_RULES), verdict, nextLook, waiting });
  }
  return out;
}

export interface OwnerIdea {
  id: string;
  name: string;
  why: string;
  when: Rule["when"];
  proposedAt: string;
  model: string;
}

/** The AI's own words for each rule, for the signed-in owner only. */
export async function readOwnerIdeas(db: Db, limit = 100): Promise<OwnerIdea[]> {
  return (await new PgIdeasStore(db).hypotheses()).slice(0, limit).map((h) => ({
    id: h.id, name: h.rule.name, why: h.rule.why, when: h.rule.when, proposedAt: new Date(h.proposedAt * 1000).toISOString(), model: h.model,
  }));
}
