/* Which free models are answering, shared by every server instance through
   the ai_model_health table (db/migrations/20261107_ai_deepseek.sql).

   Why: a "not found" costs about 0.2 s, but on 2026-11-06 DeepSeek V4.1 Flash,
   which NVIDIA lists, answered every request with "upstream request failed"
   (502) after about 30 s, more than half of a 55 s pass. So:
   - a model whose last attempts failed RESTS before it is asked again:
     15 minutes after one failure, doubling with each failure in a row, at
     most six hours; one answer clears it;
   - a model on PROBATION (PROBATION_MODELS in ./nvidia) is not asked by any
     chain until it has answered once. Its waiting second-opinion study probes
     it every six hours with `healthCheck`, which asks even a resting model.

   Health only decides whether to ASK a model. It never changes an answer or a
   study's rules, and a failure to read or save it is ignored: without a record
   every model is asked as before, except those on probation. */

import { isModelId, PROBATION_MODELS, type ChatAttempt, type ModelHealth } from "./nvidia";

export const REST_BASE_MS = 15 * 60_000;
export const REST_MAX_MS = 6 * 3600_000;
/** A timeout counts against a model only when the attempt had at least this
    long: a call cut short by the end of a pass says nothing about the model. */
export const SLOW_TIMEOUT_MS = 15_000;

export interface HealthRow {
  /** Epoch ms of the last answer, or null. */
  okAt: number | null;
  /** Epoch ms of the last counted failure, or null. */
  failAt: number | null;
  /** Counted failures since the last answer. */
  fails: number;
  /** The last counted failure's code. */
  code: string | null;
}

/** What one attempt says about the model itself, or null when it says nothing
    (skipped, cut off by the deadline, our key or our request refused). An
    empty answer is still an answer: the model is up. */
export function healthSignal(attempt: Pick<ChatAttempt, "outcome" | "ms">): "ok" | "fail" | null {
  switch (attempt.outcome) {
    case "ok":
    case "empty":
      return "ok";
    case "not-found":
    case "busy":
    case "network":
    case "rate-limited":
    case "bad-response":
      return "fail";
    case "timeout":
      return attempt.ms >= SLOW_TIMEOUT_MS ? "fail" : null;
    default:
      return null;
  }
}

/** How long a model rests after `fails` failures in a row. */
export function restMs(fails: number): number {
  if (fails <= 0) return 0;
  return Math.min(REST_MAX_MS, REST_BASE_MS * 2 ** Math.min(fails - 1, 20));
}

export function isUsable(model: string, row: HealthRow | undefined, now: number): boolean {
  if (PROBATION_MODELS.has(model) && (!row || row.okAt === null)) return false;
  if (!row || row.fails <= 0) return true;
  return now >= (row.failAt ?? 0) + restMs(row.fails);
}

/** The row after one more signal (what the database upsert computes too). */
export function nextRow(row: HealthRow | undefined, signal: "ok" | "fail", code: string, at: number): HealthRow {
  const r = row ?? { okAt: null, failAt: null, fails: 0, code: null };
  return signal === "ok"
    ? { ...r, okAt: Math.max(r.okAt ?? at, at), fails: 0 }
    : { ...r, failAt: Math.max(r.failAt ?? at, at), fails: Math.min(r.fails + 1, 1000), code };
}

export interface HealthStore {
  load(): Promise<Map<string, HealthRow>>;
  /** Records one signal; returns the stored row, or null if none came back. */
  save(model: string, signal: "ok" | "fail", code: string, at: number): Promise<HealthRow | null>;
}

/** One pass's (or one request's) view of the shared record. */
export class HealthBook implements ModelHealth {
  private constructor(private readonly rows: Map<string, HealthRow>, private readonly store: HealthStore | null) {}

  /** Never throws: an unreadable record gives an empty book that still keeps
      models on probation out, and does not try to save. */
  static async open(store: HealthStore | null): Promise<HealthBook> {
    if (!store) return new HealthBook(new Map(), null);
    try {
      return new HealthBook(await store.load(), store);
    } catch {
      return new HealthBook(new Map(), null);
    }
  }

  usable(model: string, now: number): boolean {
    return isUsable(model, this.rows.get(model), now);
  }

  /** The listed models that are resting now (for counts in a pass report). */
  resting(models: readonly string[], now: number): string[] {
    return models.filter((m) => !this.usable(m, now));
  }

  async record(attempt: ChatAttempt, now: number): Promise<void> {
    const signal = healthSignal(attempt);
    if (!signal || !isModelId(attempt.model)) return;
    this.rows.set(attempt.model, nextRow(this.rows.get(attempt.model), signal, attempt.outcome, now));
    if (!this.store) return;
    try {
      const saved = await this.store.save(attempt.model, signal, attempt.outcome, now);
      if (saved) this.rows.set(attempt.model, saved);
    } catch {
      /* best effort */
    }
  }
}

/* ── Postgres (the restricted aegis_ai login, AI_DATABASE_URL) ── */

interface Db {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

function rowOf(r: Record<string, unknown>): HealthRow | null {
  const fails = Number(r.fails);
  if (!Number.isInteger(fails) || fails < 0) return null;
  return { okAt: msOf(r.ok_ms), failAt: msOf(r.fail_ms), fails, code: typeof r.fail_code === "string" ? r.fail_code : null };
}

const COLUMNS = `extract(epoch FROM ok_at) * 1000 AS ok_ms, extract(epoch FROM fail_at) * 1000 AS fail_ms, fails, fail_code`;

export class PgHealthStore implements HealthStore {
  constructor(private readonly db: Db) {}

  async load(): Promise<Map<string, HealthRow>> {
    const { rows } = await this.db.query(`SELECT model, ${COLUMNS} FROM public.ai_model_health`);
    const out = new Map<string, HealthRow>();
    for (const r of rows) {
      const row = isModelId(r.model) ? rowOf(r) : null;
      if (row) out.set(r.model as string, row);
    }
    return out;
  }

  async save(model: string, signal: "ok" | "fail", code: string, at: number): Promise<HealthRow | null> {
    // One atomic upsert, so two instances recording at once both count.
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_model_health AS h (model, ok_at, fail_at, fails, fail_code, updated_at)
       VALUES ($1, CASE WHEN $2::boolean THEN $3::timestamptz END, CASE WHEN $2::boolean THEN NULL ELSE $3::timestamptz END,
         CASE WHEN $2::boolean THEN 0 ELSE 1 END, CASE WHEN $2::boolean THEN NULL ELSE $4::text END, now())
       ON CONFLICT (model) DO UPDATE SET
         ok_at = CASE WHEN $2::boolean THEN greatest(h.ok_at, $3::timestamptz) ELSE h.ok_at END,
         fail_at = CASE WHEN $2::boolean THEN h.fail_at ELSE greatest(h.fail_at, $3::timestamptz) END,
         fails = CASE WHEN $2::boolean THEN 0 ELSE least(h.fails + 1, 1000) END,
         fail_code = CASE WHEN $2::boolean THEN h.fail_code ELSE $4::text END,
         updated_at = now()
       RETURNING ${COLUMNS}`,
      [model, signal === "ok", new Date(at).toISOString(), code]);
    return rows[0] ? rowOf(rows[0]) : null;
  }
}
