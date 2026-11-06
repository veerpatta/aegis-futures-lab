/* Postgres storage for coach notes through the restricted aegis_ai role.
   Reads the learner's records; inserts append-only ai_notes rows only. */

import type { Db } from "@/lib/ai-judge/store-pg";
import { tradingDayKey } from "@/lib/time/ny";
import type { DayRecord, TradeRecord } from "./facts";
import type { CoachNote, CoachStore } from "./runner";

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const count = (v: unknown) => Number(v) || 0;

function changePct(bars: { time: number; open: number; close: number }[], dayKey: string): number | null {
  const today = bars.filter((b) => tradingDayKey(b.time) === dayKey).sort((a, b) => a.time - b.time);
  if (!today.length || !(today[0].open > 0)) return null;
  return Math.round(((today[today.length - 1].close - today[0].open) / today[0].open) * 10000) / 100;
}

export class PgCoachStore implements CoachStore {
  constructor(private readonly db: Db) {}

  async activeExperiment(): Promise<string | null> {
    const { rows } = await this.db.query(`SELECT id FROM public.experiments WHERE lineage = 'learner' AND status = 'active' ORDER BY campaign DESC LIMIT 1`);
    return typeof rows[0]?.id === "string" ? rows[0].id : null;
  }

  async finishedTrades(experimentId: string, sinceSec: number, limit: number): Promise<TradeRecord[]> {
    const { rows } = await this.db.query(
      `SELECT d.decision_key, d.symbol, d.side, d.action, d.reason, extract(epoch FROM d.decided_at)::float8 AS decided, d.idea, d.est_risk,
         p.status AS p_status, p.qty AS p_qty, p.fill_price AS p_fill, extract(epoch FROM p.fill_ts)::float8 AS p_fill_ts,
         p.exit_price AS p_exit, extract(epoch FROM p.exit_ts)::float8 AS p_exit_ts, p.exit_reason AS p_exit_reason, p.net AS p_net, p.cancel_reason AS p_cancel,
         o.outcome_status AS o_status, o.status AS o_sim_status, o.net AS o_net, o.exit_reason AS o_exit_reason, o.exit_price AS o_exit,
         extract(epoch FROM o.exit_ts)::float8 AS o_exit_ts, o.fill_price AS o_fill, extract(epoch FROM o.fill_ts)::float8 AS o_fill_ts
       FROM public.experiment_decisions d
       LEFT JOIN public.experiment_positions p ON p.decision_key = d.decision_key
       LEFT JOIN public.experiment_outcomes o ON o.decision_key = d.decision_key
       WHERE d.experiment_id = $1 AND d.created_at >= to_timestamp($2)
         AND ((d.action = 'take' AND p.status IN ('closed', 'cancelled')) OR (d.action = 'skip' AND o.outcome_status IN ('closed', 'void')))
         AND NOT EXISTS (SELECT 1 FROM public.ai_notes n WHERE n.kind = 'trade' AND n.subject = d.decision_key)
       ORDER BY d.decided_at, d.decision_key LIMIT $3`,
      [experimentId, sinceSec, limit]);
    return rows.flatMap((r) => {
      const decided = toNum(r.decided);
      if (typeof r.decision_key !== "string" || decided === null || (r.action !== "take" && r.action !== "skip")) return [];
      return [{
        decisionKey: r.decision_key, symbol: String(r.symbol), side: String(r.side), action: r.action, reason: String(r.reason ?? ""),
        decidedAt: decided, idea: (r.idea as Record<string, unknown>) ?? null, estRisk: r.est_risk,
        position: { status: (r.p_status as string) ?? null, qty: r.p_qty, fill: r.p_fill, fillTs: r.p_fill_ts, exit: r.p_exit, exitTs: r.p_exit_ts, exitReason: r.p_exit_reason, net: r.p_net, cancelReason: r.p_cancel },
        outcome: { status: (r.o_status as string) ?? null, simStatus: (r.o_sim_status as string) ?? null, net: r.o_net, exitReason: r.o_exit_reason, exit: r.o_exit, exitTs: r.o_exit_ts, fill: r.o_fill, fillTs: r.o_fill_ts },
      }];
    });
  }

  async day(experimentId: string, dayKey: string, nowSec: number): Promise<DayRecord | null> {
    const bars = await this.db.query(
      `SELECT symbol, time, open, close FROM public.bars_5m WHERE source = 'yahoo' AND symbol IN ('MES', 'MNQ') AND time >= $1 AND time + 300 <= $2 ORDER BY time`,
      [nowSec - 36 * 3600, nowSec]);
    const series = (symbol: string) => bars.rows.filter((b) => b.symbol === symbol).map((b) => ({ time: Number(b.time), open: Number(b.open), close: Number(b.close) }));
    const sp = changePct(series("MES"), dayKey), nq = changePct(series("MNQ"), dayKey);
    // No market data for the day (weekend, holiday): nothing to recap.
    if (sp === null && nq === null) return null;
    const decisions = await this.db.query(
      `SELECT count(*) AS decided, count(*) FILTER (WHERE action = 'take') AS taken, count(*) FILTER (WHERE action = 'skip') AS skipped
       FROM public.experiment_decisions WHERE experiment_id = $1 AND session_key = $2`, [experimentId, dayKey]);
    const positions = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'closed') AS closed, count(*) FILTER (WHERE status = 'closed' AND net > 0) AS wins,
         count(*) FILTER (WHERE status = 'closed' AND net <= 0) AS losses, coalesce(sum(net) FILTER (WHERE status = 'closed'), 0) AS net,
         count(*) FILTER (WHERE status IN ('open', 'pending_fill')) AS open
       FROM public.experiment_positions WHERE experiment_id = $1 AND session_key = $2`, [experimentId, dayKey]);
    const account = await this.db.query(`SELECT equity FROM public.experiment_account WHERE experiment_id = $1`, [experimentId]);
    const d = decisions.rows[0] ?? {}, p = positions.rows[0] ?? {};
    return {
      dayKey, decided: count(d.decided), taken: count(d.taken), skipped: count(d.skipped), closed: count(p.closed), wins: count(p.wins),
      losses: count(p.losses), resultUsd: Number(p.net) || 0, open: count(p.open), balanceUsd: toNum(account.rows[0]?.equity),
      sp500ChangePct: sp, nasdaqChangePct: nq,
    };
  }

  async latestDayNote(dayKey: string): Promise<{ factsHash: string; createdAt: number } | null> {
    const { rows } = await this.db.query(
      `SELECT facts_hash, extract(epoch FROM created_at)::float8 AS at FROM public.ai_notes WHERE kind = 'day' AND subject = $1 ORDER BY created_at DESC LIMIT 1`, [dayKey]);
    const at = toNum(rows[0]?.at);
    return typeof rows[0]?.facts_hash === "string" && at !== null ? { factsHash: rows[0].facts_hash, createdAt: at * 1000 } : null;
  }

  async save(note: CoachNote, atMs: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `INSERT INTO public.ai_notes (kind, subject, facts_hash, model, prompt_version, status, text, reject_reason, facts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (kind, subject, facts_hash) DO NOTHING RETURNING id`,
      [note.kind, note.subject, note.factsHash, note.model, note.promptVersion, note.status, note.text, note.rejectReason, JSON.stringify(note.facts), new Date(atMs).toISOString()]);
    return rows.length === 1;
  }
}

export interface OwnerNote {
  kind: "trade" | "day" | "week";
  subject: string;
  text: string;
  model: string;
  createdAt: string;
}

/** Accepted notes only: a rejected note is never shown. */
export async function readOwnerNotes(db: Db, limit = 300): Promise<OwnerNote[]> {
  const { rows } = await db.query(
    `SELECT kind, subject, text, model, created_at FROM public.ai_notes WHERE status = 'accepted' ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.flatMap((r) =>
    (r.kind === "trade" || r.kind === "day" || r.kind === "week") && typeof r.subject === "string" && typeof r.text === "string"
      ? [{ kind: r.kind, subject: r.subject, text: r.text, model: String(r.model ?? ""), createdAt: new Date(r.created_at as string | Date).toISOString() }]
      : []);
}
