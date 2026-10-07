/* ExperimentStore over Neon Postgres (node-postgres Pool).

   A tick runs in ONE transaction: it takes a per-experiment advisory
   transaction lock (pg_try_advisory_xact_lock works through the pooled,
   transaction-mode URL), locks the account row, and commits the decisions,
   trades, fills and the advanced cursor together — a crash before COMMIT
   leaves no trace and the next tick redoes the work; a crash after it is
   seen as done. Learning jobs hold a lease row instead, because they may run
   longer than one statement batch should hold a lock.

   It only ever writes experiment_* tables. It reads bars_5m and signals and
   never writes them; it never touches paper_*, model_registry or the journal
   (tests/experiment-isolation.test.ts greps this file to keep it that way). */

import { Pool, type PoolClient } from "pg";
import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import { COST_VERSION } from "./policy";
import type {
  ChangeRecord, DatasetRecord, EvaluationRecord, ExperimentStore, LearnState, LearnTx, PointerRecord, RunStatus, ShadowScoreRecord, TickState, TickTx, VersionRecord,
} from "./store";
import type { TickResult } from "./step";
import type { Account, Decision, ExperimentConfig, ExperimentStatus, ExpSymbol, Outcome, Position, SimTrade } from "./types";

type Row = Record<string, unknown>;
const sec = (v: unknown): number | null => (v == null ? null : Math.floor(new Date(v as string).getTime() / 1000));
const iso = (s: number | null | undefined): string | null => (s == null ? null : new Date(s * 1000).toISOString());
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

let shared: Pool | undefined;
export function experimentPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required for the experiment store.");
  if (!shared) {
    const url = new URL(connectionString);
    if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
    shared = new Pool({ connectionString: url.toString(), max: 3, allowExitOnIdle: true, idleTimeoutMillis: 10_000 });
    shared.on("error", () => { /* idle client dropped (scale-to-zero); the next query reconnects */ });
  }
  return shared;
}

function expFromRow(r: Row): ExperimentConfig {
  return {
    id: String(r.id), lineage: String(r.lineage), campaign: Number(r.campaign), mode: r.mode as ExperimentConfig["mode"],
    status: r.status as ExperimentStatus, capital: Number(r.capital), startedAt: sec(r.started_at)!, seed: Number(r.seed),
  };
}

function accountFromRow(r: Row): Account {
  return {
    equity: Number(r.equity), realized: Number(r.realized), unrealized: Number(r.unrealized), unpricedPositions: Number(r.unpriced_positions),
    peak: Number(r.peak), dayKey: String(r.day_key ?? ""), dayStartEquity: Number(r.day_start_equity), dailyPnl: Number(r.daily_pnl),
    openRisk: Number(r.open_risk), dayHalted: !!r.day_halted, lockedAt: sec(r.locked_at), cursor: (r.cursor as Account["cursor"]) ?? {},
    staleSymbols: ((r.stale_symbols as string[]) ?? []) as ExpSymbol[], lastOkTickAt: sec(r.last_ok_tick_at),
  };
}

function simFromRow(r: Row): SimTrade {
  return {
    symbol: r.symbol as ExpSymbol, side: r.side as SimTrade["side"], qty: Number(r.qty ?? 1), stop: Number(r.stop), target: num(r.target),
    decidedAt: sec(r.decided_at)!, sessionKey: String(r.session_key), status: r.status as SimTrade["status"],
    cancelReason: (r.cancel_reason as SimTrade["cancelReason"]) ?? null, fillTs: sec(r.fill_ts), fillPrice: num(r.fill_price), entrySlip: num(r.entry_slip),
    risk: num(r.risk), mark: num(r.mark), markTs: sec(r.mark_ts), stale: !!r.stale, exitTs: sec(r.exit_ts), exitPrice: num(r.exit_price),
    exitSlip: num(r.exit_slip), exitReason: (r.exit_reason as SimTrade["exitReason"]) ?? null, ambiguous: !!r.ambiguous,
    gross: num(r.gross), fees: num(r.fees), net: num(r.net),
  };
}

const SIM_COLS = ["symbol", "side", "stop", "target", "decided_at", "session_key", "status", "cancel_reason", "fill_ts", "fill_price", "entry_slip", "risk",
  "mark", "mark_ts", "exit_ts", "exit_price", "exit_slip", "exit_reason", "ambiguous", "gross", "fees", "net"] as const;
const simValues = (t: SimTrade) => [t.symbol, t.side, t.stop, t.target, iso(t.decidedAt), t.sessionKey, t.status, t.cancelReason, iso(t.fillTs), t.fillPrice,
  t.entrySlip, t.risk, t.mark, iso(t.markTs), iso(t.exitTs), t.exitPrice, t.exitSlip, t.exitReason, t.ambiguous, t.gross, t.fees, t.net];

function versionFromRow(r: Row): VersionRecord {
  return {
    id: String(r.id), experimentId: String(r.experiment_id), kind: r.kind as VersionRecord["kind"], spec: (r.spec as VersionRecord["spec"]) ?? {},
    specHash: String(r.spec_hash), weekKey: String(r.week_key), registeredAt: sec(r.registered_at)!, datasetId: (r.dataset_id as string) ?? null,
    artifact: (r.artifact as VersionRecord["artifact"]) ?? null, artifactHash: (r.artifact_hash as string) ?? null, trainedAt: sec(r.trained_at),
    trainCutoff: sec(r.train_cutoff), status: r.status as VersionRecord["status"], statusReason: (r.status_reason as string) ?? null,
  };
}

function decisionFromRow(r: Row): Decision {
  return {
    key: String(r.decision_key), opportunityKey: String(r.opportunity_key), signalId: num(r.signal_id), symbol: r.symbol as ExpSymbol, side: r.side as Decision["side"],
    sessionKey: String(r.session_key), seenAt: sec(r.seen_at)!, infoCutoff: sec(r.info_cutoff)!, decidedAt: sec(r.decided_at)!,
    provenance: r.provenance as Decision["provenance"], modelVersionId: String(r.model_version_id), pWin: num(r.p_win), threshold: num(r.threshold),
    action: r.action as Decision["action"], reason: r.reason as Decision["reason"], qty: Number(r.qty), estRisk: num(r.est_risk), refPrice: num(r.ref_price),
    idea: r.idea as Decision["idea"], features: (r.features as Decision["features"]) ?? null, featureVersion: String(r.feature_version), snapshotHash: String(r.snapshot_hash),
  };
}

const outcomeFromRow = (r: Row): Outcome => ({
  decisionKey: String(r.decision_key), status: r.outcome_status as Outcome["status"], voidReason: (r.void_reason as string) ?? null,
  standaloneQty: Number(r.standalone_qty), sim: { ...simFromRow(r), qty: 1, stale: false },
});
const positionFromRow = (r: Row): Position => ({ ...simFromRow(r), id: String(r.id), decisionKey: String(r.decision_key) });
const pointerFromRow = (r: Row): PointerRecord => ({ versionId: String(r.model_version_id), previousVersionId: (r.previous_version_id as string) ?? null, updatedAt: sec(r.updated_at)! });

async function insertChange(c: PoolClient, experimentId: string, ch: ChangeRecord): Promise<number> {
  // DO NOTHING (not an upsert): the append-only trigger refuses any UPDATE, and
  // a retried event simply reuses the change it already recorded.
  const r = await c.query(
    `INSERT INTO experiment_changes(experiment_id,kind,from_status,to_status,from_version,to_version,reason,evidence,actor,event_key,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,now())) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
    [experimentId, ch.kind, ch.fromStatus ?? null, ch.toStatus ?? null, ch.fromVersion ?? null, ch.toVersion ?? null, ch.reason, json(ch.evidence ?? {}),
      ch.actor ?? "system", ch.eventKey, iso(ch.createdAt ?? null)],
  );
  if (r.rows[0]) return Number(r.rows[0].id);
  return Number((await c.query("SELECT id FROM experiment_changes WHERE event_key=$1", [ch.eventKey])).rows[0].id);
}

async function swapPointer(c: PoolClient, experimentId: string, to: string, changeId: number, at: number, previous?: string | null) {
  await c.query(
    `UPDATE experiment_pointer SET previous_version_id = CASE WHEN $4::boolean THEN $5 ELSE model_version_id END,
       model_version_id=$2, change_id=$3, updated_at=$6 WHERE experiment_id=$1`,
    [experimentId, to, changeId, previous !== undefined, previous ?? null, iso(at)],
  );
}

export class PgStore implements ExperimentStore {
  constructor(private pool: Pool = experimentPool()) {}

  private async tx<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await work(c);
      await c.query("COMMIT");
      return out;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  async activeExperiment(lineage: string) {
    const r = await this.pool.query(
      `SELECT * FROM experiments WHERE lineage=$1 ORDER BY (status IN ('active','paused')) DESC, campaign DESC LIMIT 1`, [lineage]);
    return r.rows[0] ? expFromRow(r.rows[0]) : null;
  }

  async beginRun(r: { experimentId: string; job: string; invocationId: string; trigger: string; scheduledAt: number | null; codeSha: string | null }) {
    const ins = await this.pool.query(
      `INSERT INTO experiment_runs(experiment_id,job,invocation_id,trigger,scheduled_at,code_sha) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (experiment_id,job,invocation_id) DO NOTHING RETURNING id`,
      [r.experimentId, r.job, r.invocationId, r.trigger, iso(r.scheduledAt), r.codeSha],
    );
    if (ins.rows[0]) return { runId: Number(ins.rows[0].id), replay: null };
    const ex = (await this.pool.query(`SELECT * FROM experiment_runs WHERE experiment_id=$1 AND job=$2 AND invocation_id=$3`, [r.experimentId, r.job, r.invocationId])).rows[0];
    // A retry of a finished run returns the stored result. A run that died
    // mid-way (still "running" after 15 minutes) is taken over under a new id.
    if (ex.status !== "running" && ex.status !== "error") return { runId: Number(ex.id), replay: { status: ex.status as RunStatus, counts: ex.counts ?? {}, message: ex.message ?? null } };
    const retry = await this.pool.query(
      `INSERT INTO experiment_runs(experiment_id,job,invocation_id,trigger,scheduled_at,code_sha) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [r.experimentId, r.job, `${r.invocationId}:retry:${Date.now()}`, r.trigger, iso(r.scheduledAt), r.codeSha],
    );
    return { runId: Number(retry.rows[0].id), replay: null };
  }

  async finishRun(runId: number, r: { status: RunStatus; counts: Record<string, unknown>; message: string | null; durationMs: number; quotaLevel: string | null; dbBytes: number | null }) {
    await this.pool.query(
      `UPDATE experiment_runs SET finished_at=now(), status=$2, counts=$3, message=$4, duration_ms=$5, quota_level=$6, db_bytes=$7 WHERE id=$1 AND finished_at IS NULL`,
      [runId, r.status, json(r.counts), r.message, Math.round(r.durationMs), r.quotaLevel, r.dbBytes],
    );
  }

  async quotaInputs() {
    const r = await this.pool.query(
      `SELECT pg_database_size(current_database())::bigint AS db_bytes,
        (SELECT coalesce(sum(duration_ms),0)/1000.0 FROM experiment_runs WHERE started_at >= date_trunc('month', now())) AS run_sec`);
    return { dbBytes: num(r.rows[0]?.db_bytes), monthRunSec: num(r.rows[0]?.run_sec) };
  }

  private async loadTick(c: PoolClient, experimentId: string): Promise<TickState> {
    const exp = expFromRow((await c.query("SELECT * FROM experiments WHERE id=$1", [experimentId])).rows[0]);
    const account = accountFromRow((await c.query("SELECT * FROM experiment_account WHERE experiment_id=$1 FOR UPDATE", [experimentId])).rows[0]);
    const positions = (await c.query("SELECT * FROM experiment_positions WHERE experiment_id=$1 AND status IN ('pending_fill','open')", [experimentId])).rows.map(positionFromRow);
    const outcomes = (await c.query("SELECT * FROM experiment_outcomes WHERE experiment_id=$1 AND outcome_status IN ('pending','open')", [experimentId])).rows.map(outcomeFromRow);
    const pointer = pointerFromRow((await c.query("SELECT * FROM experiment_pointer WHERE experiment_id=$1", [experimentId])).rows[0]);
    const versions = (await c.query("SELECT * FROM experiment_model_versions WHERE experiment_id=$1 AND (status IN ('shadowing','adopted') OR id=$2 OR id=$3)",
      [experimentId, pointer.versionId, pointer.previousVersionId])).rows.map(versionFromRow);
    return { exp, account, positions, outcomes, pointer, versions };
  }

  async tick<T>(experimentId: string, work: (tx: TickTx) => Promise<T>): Promise<T | "busy"> {
    return this.tx(async (c) => {
      const got = (await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended('aegis-exp:' || $1, 0)) AS ok", [experimentId])).rows[0];
      if (!got?.ok) return "busy" as const;
      const tx: TickTx = {
        load: () => this.loadTick(c, experimentId),
        bars: async (symbol, fromSec, toSec) =>
          (await c.query(
            `SELECT time, open, high, low, close, volume FROM bars_5m WHERE symbol=$1 AND source='yahoo' AND time >= $2 AND time + 300 <= $3 ORDER BY time`,
            [symbol, fromSec, toSec],
          )).rows.map((r) => ({ time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume ?? 0) }) as Bar),
        signals: async (sinceSec) => (await c.query("SELECT * FROM signals WHERE signal_ts >= $1 ORDER BY signal_ts, id", [iso(sinceSec)])).rows as SignalRow[],
        decided: async (keys) => {
          if (!keys.length) return new Set();
          const r = await c.query("SELECT opportunity_key FROM experiment_decisions WHERE experiment_id=$1 AND opportunity_key = ANY($2)", [experimentId, keys]);
          return new Set(r.rows.map((x) => String(x.opportunity_key)));
        },
        persist: (runId, state, result, nowSec, writeEquity) => this.persist(c, experimentId, runId, state, result, nowSec, writeEquity),
        rollback: async (change, to, at) => {
          const id = await insertChange(c, experimentId, change);
          await swapPointer(c, experimentId, to, id, at, null);
          await c.query("UPDATE experiment_model_versions SET status='rolled_back', status_reason=$2, updated_at=now() WHERE id=$1", [change.fromVersion, change.reason]);
          await c.query("UPDATE experiment_model_versions SET status='adopted', status_reason=$2, updated_at=now() WHERE id=$1 AND status <> 'adopted'", [to, `restored after ${change.reason}`]);
        },
      };
      return work(tx);
    });
  }

  private async persist(c: PoolClient, experimentId: string, runId: number, state: TickState, r: TickResult, nowSec: number, writeEquity: boolean) {
    for (const d of r.decisions) {
      await c.query(
        `INSERT INTO experiment_decisions(decision_key,experiment_id,opportunity_key,signal_id,symbol,side,session_key,seen_at,info_cutoff,decided_at,provenance,
          model_version_id,p_win,threshold,action,reason,qty,est_risk,ref_price,idea,features,feature_version,snapshot_hash,run_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [d.key, experimentId, d.opportunityKey, d.signalId, d.symbol, d.side, d.sessionKey, iso(d.seenAt), iso(d.infoCutoff), iso(d.decidedAt), d.provenance,
          d.modelVersionId, d.pWin, d.threshold, d.action, d.reason, d.qty, d.estRisk, d.refPrice, json(d.idea), json(d.features), d.featureVersion, d.snapshotHash, runId],
      );
    }
    const newIds = new Set(r.newPositionIds);
    for (const p of r.positions) {
      if (newIds.has(p.id)) {
        await c.query(
          `INSERT INTO experiment_positions(id,experiment_id,decision_key,qty,stale,${SIM_COLS.join(",")})
           VALUES($1,$2,$3,$4,$5,${SIM_COLS.map((_, i) => `$${i + 6}`).join(",")})`,
          [p.id, experimentId, p.decisionKey, p.qty, p.stale, ...simValues(p)],
        );
      } else {
        await c.query(
          `UPDATE experiment_positions SET qty=$2, stale=$3, ${SIM_COLS.map((col, i) => `${col}=$${i + 4}`).join(",")}, updated_at=now() WHERE id=$1`,
          [p.id, p.qty, p.stale, ...simValues(p)],
        );
      }
    }
    const newOutcomes = new Set(r.newOutcomeKeys);
    for (const o of r.outcomes) {
      if (newOutcomes.has(o.decisionKey)) {
        await c.query(
          `INSERT INTO experiment_outcomes(decision_key,experiment_id,outcome_status,void_reason,standalone_qty,${SIM_COLS.join(",")})
           VALUES($1,$2,$3,$4,$5,${SIM_COLS.map((_, i) => `$${i + 6}`).join(",")})`,
          [o.decisionKey, experimentId, o.status, o.voidReason, o.standaloneQty, ...simValues(o.sim)],
        );
      } else {
        await c.query(
          `UPDATE experiment_outcomes SET outcome_status=$2, void_reason=$3, ${SIM_COLS.map((col, i) => `${col}=$${i + 4}`).join(",")}, updated_at=now() WHERE decision_key=$1`,
          [o.decisionKey, o.status, o.voidReason, ...simValues(o.sim)],
        );
      }
    }
    for (const f of r.fills) {
      await c.query(
        `INSERT INTO experiment_fills(fill_key,experiment_id,position_id,kind,bar_time,raw_price,slippage_points,price,qty,commission,cost_version)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (fill_key) DO NOTHING`,
        [f.key, experimentId, f.positionId, f.kind, iso(f.barTime), f.rawPrice, f.slippagePoints, f.price, f.qty, f.commission, COST_VERSION],
      );
    }
    for (const s of r.shadowScores) {
      await c.query(
        `INSERT INTO experiment_shadow_scores(decision_key,model_version_id,p_win,would_take) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [s.decisionKey, s.versionId, s.p, s.wouldTake],
      );
    }
    for (const e of r.events) {
      const id = await insertChange(c, experimentId, {
        kind: e.kind, reason: e.reason, eventKey: `${e.kind}:${experimentId}:${e.at}`, createdAt: e.at,
        fromStatus: e.kind === "locked" ? state.exp.status : null, toStatus: e.kind === "locked" ? "locked" : null,
      });
      if (e.kind === "locked" && state.exp.status !== "locked")
        await c.query("UPDATE experiments SET status='locked', status_reason=$2, last_change_id=$3 WHERE id=$1", [experimentId, e.reason, id]);
    }
    const a = r.account;
    await c.query(
      `UPDATE experiment_account SET equity=$2, realized=$3, unrealized=$4, unpriced_positions=$5, peak=$6, day_key=$7, day_start_equity=$8, daily_pnl=$9,
        open_risk=$10, day_halted=$11, locked_at=$12, cursor=$13, stale_symbols=$14, last_ok_tick_at=$15, version=version+1, updated_at=now() WHERE experiment_id=$1`,
      [experimentId, a.equity, a.realized, a.unrealized, a.unpricedPositions, a.peak, a.dayKey, a.dayStartEquity, a.dailyPnl, Math.max(0, a.openRisk),
        a.dayHalted, iso(a.lockedAt), json(a.cursor), a.staleSymbols, iso(a.lastOkTickAt)],
    );
    if (writeEquity) await insertEquity(c, experimentId, runId, "tick", nowSec, a);
  }

  async learner<T>(experimentId: string, holder: string, work: (tx: LearnTx) => Promise<T>): Promise<T | "busy"> {
    const lease = await this.pool.query(
      `INSERT INTO experiment_leases(experiment_id, job, holder, expires_at) VALUES($1,'learner',$2, now() + interval '20 minutes')
       ON CONFLICT (experiment_id, job) DO UPDATE SET holder=EXCLUDED.holder, expires_at=EXCLUDED.expires_at
       WHERE experiment_leases.expires_at < now() OR experiment_leases.holder = EXCLUDED.holder RETURNING holder`,
      [experimentId, holder],
    );
    if (!lease.rows[0]) return "busy";
    try {
      return await this.tx(async (c) => {
        const tx: LearnTx = {
          load: () => this.loadLearn(c, experimentId),
          insertDataset: async (runId, d: DatasetRecord) => {
            await c.query(
              `INSERT INTO experiment_datasets(id,experiment_id,cutoff,feature_version,row_count,decision_keys,rows_hash,filters,stats,run_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
              [d.id, experimentId, iso(d.cutoff), d.featureVersion, d.rowCount, d.decisionKeys, d.rowsHash, json(d.filters), json(d.stats), runId],
            );
          },
          insertVersion: async (v) => {
            await c.query(
              `INSERT INTO experiment_model_versions(id,experiment_id,kind,spec,spec_hash,week_key,registered_at,dataset_id,artifact,artifact_hash,trained_at,train_cutoff,status,status_reason)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
              [v.id, experimentId, v.kind, json(v.spec), v.specHash, v.weekKey, iso(v.registeredAt), v.datasetId, json(v.artifact), v.artifactHash,
                iso(v.trainedAt), iso(v.trainCutoff), v.status, v.statusReason],
            );
          },
          updateVersion: async (id, p) => {
            const sets: string[] = [], vals: unknown[] = [id];
            const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
            if (p.artifact !== undefined) add("artifact", json(p.artifact));
            if (p.artifactHash !== undefined) add("artifact_hash", p.artifactHash);
            if (p.trainedAt !== undefined) add("trained_at", iso(p.trainedAt));
            if (p.trainCutoff !== undefined) add("train_cutoff", iso(p.trainCutoff));
            if (p.datasetId !== undefined) add("dataset_id", p.datasetId);
            if (p.status !== undefined) add("status", p.status);
            if (p.statusReason !== undefined) add("status_reason", p.statusReason);
            if (sets.length) await c.query(`UPDATE experiment_model_versions SET ${sets.join(",")}, updated_at=now() WHERE id=$1`, vals);
          },
          insertEvaluation: async (runId, e: EvaluationRecord) => {
            await c.query(
              `INSERT INTO experiment_evaluations(experiment_id,run_id,model_version_id,incumbent_version_id,dataset_id,kind,window_from,window_to,n_oos,n_sessions,
                total_outcomes,metrics,seeds,verdict,reasons,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
              [experimentId, runId, e.versionId, e.incumbentVersionId, e.datasetId, e.kind, iso(e.windowFrom), iso(e.windowTo), e.nOos, e.nSessions,
                e.totalOutcomes, json(finite(e.metrics)), json(e.seeds), e.verdict, e.reasons, iso(e.createdAt)],
            );
          },
          insertChange: (ch) => insertChange(c, experimentId, ch),
          swapPointer: (to, changeId, at, previous) => swapPointer(c, experimentId, to, changeId, at, previous),
          insertEquity: (runId, kind, asOf, account) => insertEquity(c, experimentId, runId, kind, asOf, account),
        };
        return work(tx);
      });
    } finally {
      await this.pool.query("DELETE FROM experiment_leases WHERE experiment_id=$1 AND job='learner' AND holder=$2", [experimentId, holder]).catch(() => {});
    }
  }

  private async loadLearn(c: PoolClient, experimentId: string): Promise<LearnState> {
    const q = (sql: string) => c.query(sql, [experimentId]).then((r) => r.rows);
    const exp = expFromRow((await q("SELECT * FROM experiments WHERE id=$1"))[0]);
    const account = accountFromRow((await q("SELECT * FROM experiment_account WHERE experiment_id=$1"))[0]);
    const decisions = (await q("SELECT * FROM experiment_decisions WHERE experiment_id=$1 ORDER BY decided_at, id")).map(decisionFromRow);
    const outcomes = (await q("SELECT * FROM experiment_outcomes WHERE experiment_id=$1")).map(outcomeFromRow);
    const versions = (await q("SELECT * FROM experiment_model_versions WHERE experiment_id=$1 ORDER BY registered_at")).map(versionFromRow);
    const evaluations = (await q("SELECT * FROM experiment_evaluations WHERE experiment_id=$1 ORDER BY created_at")).map((r): EvaluationRecord => ({
      id: Number(r.id), versionId: String(r.model_version_id), incumbentVersionId: (r.incumbent_version_id as string) ?? null, datasetId: (r.dataset_id as string) ?? null,
      kind: r.kind as EvaluationRecord["kind"], windowFrom: sec(r.window_from), windowTo: sec(r.window_to), nOos: Number(r.n_oos), nSessions: Number(r.n_sessions),
      totalOutcomes: Number(r.total_outcomes), metrics: r.metrics as EvaluationRecord["metrics"], seeds: (r.seeds as Record<string, number>) ?? {},
      verdict: r.verdict as EvaluationRecord["verdict"], reasons: (r.reasons as string[]) ?? [], createdAt: sec(r.created_at)!,
    }));
    const changes = (await q("SELECT * FROM experiment_changes WHERE experiment_id=$1 ORDER BY id")).map((r): ChangeRecord => ({
      id: Number(r.id), kind: r.kind as ChangeRecord["kind"], fromStatus: r.from_status as string, toStatus: r.to_status as string,
      fromVersion: r.from_version as string, toVersion: r.to_version as string, reason: String(r.reason), evidence: r.evidence as Record<string, unknown>,
      actor: r.actor as ChangeRecord["actor"], eventKey: String(r.event_key), createdAt: sec(r.created_at)!,
    }));
    const pointer = pointerFromRow((await q("SELECT * FROM experiment_pointer WHERE experiment_id=$1"))[0]);
    const shadowScores = (await q(`SELECT s.* FROM experiment_shadow_scores s JOIN experiment_decisions d ON d.decision_key = s.decision_key WHERE d.experiment_id=$1`))
      .map((r): ShadowScoreRecord => ({ decisionKey: String(r.decision_key), versionId: String(r.model_version_id), p: num(r.p_win), wouldTake: !!r.would_take }));
    const ds = (await q("SELECT * FROM experiment_datasets WHERE experiment_id=$1 ORDER BY built_at DESC LIMIT 1"))[0];
    const latestDataset: DatasetRecord | null = ds ? {
      id: String(ds.id), cutoff: sec(ds.cutoff)!, featureVersion: String(ds.feature_version), rowCount: Number(ds.row_count), decisionKeys: ds.decision_keys as string[],
      rowsHash: String(ds.rows_hash), filters: ds.filters as Record<string, unknown>, stats: ds.stats as Record<string, unknown>, builtAt: sec(ds.built_at)!,
    } : null;
    return { exp, account, decisions, outcomes, versions, evaluations, changes, pointer, shadowScores, latestDataset };
  }

  async setStatus(experimentId: string, to: ExperimentStatus, change: ChangeRecord) {
    await this.tx(async (c) => {
      const cur = (await c.query("SELECT status FROM experiments WHERE id=$1 FOR UPDATE", [experimentId])).rows[0];
      const id = await insertChange(c, experimentId, { ...change, fromStatus: cur.status, toStatus: to, actor: change.actor ?? "owner" });
      await c.query("UPDATE experiments SET status=$2, status_reason=$3, last_change_id=$4 WHERE id=$1", [experimentId, to, change.reason, id]);
    });
  }

  async createExperiment(input: { exp: ExperimentConfig; risk: Record<string, unknown>; prereg: Record<string, unknown>; preregHash: string; v1: VersionRecord; reason: string }) {
    const { exp, v1 } = input;
    await this.tx(async (c) => {
      await c.query(
        `INSERT INTO experiments(id,lineage,campaign,mode,status,capital,risk,prereg,prereg_hash,data_label,seed,started_at)
         VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11)`,
        [exp.id, exp.lineage, exp.campaign, exp.mode, exp.capital, json(input.risk), json(input.prereg), input.preregHash,
          exp.mode === "synthetic" ? "synthetic" : "delayed", exp.seed, iso(exp.startedAt)],
      );
      await c.query(
        `INSERT INTO experiment_account(experiment_id,equity,peak,day_start_equity) VALUES($1,$2,$2,$2)`, [exp.id, exp.capital]);
      await c.query(
        `INSERT INTO experiment_model_versions(id,experiment_id,kind,spec,spec_hash,week_key,registered_at,artifact,artifact_hash,status,status_reason)
         VALUES($1,$2,'take_all','{}',$3,$4,$5,$6,$7,'adopted',$8)`,
        [v1.id, exp.id, v1.specHash, v1.weekKey, iso(v1.registeredAt), json(v1.artifact), v1.artifactHash, v1.statusReason],
      );
      const changeId = await insertChange(c, exp.id, {
        kind: "campaign_started", toStatus: "active", toVersion: v1.id, reason: input.reason, actor: "owner", eventKey: `campaign:${exp.id}`,
        evidence: { preregHash: input.preregHash, mode: exp.mode },
      });
      await c.query(`INSERT INTO experiment_pointer(experiment_id,model_version_id,change_id,updated_at) VALUES($1,$2,$3,$4)`, [exp.id, v1.id, changeId, iso(exp.startedAt)]);
      await c.query("UPDATE experiments SET last_change_id=$2 WHERE id=$1", [exp.id, changeId]);
    });
  }
}

async function insertEquity(c: PoolClient, experimentId: string, runId: number, kind: "tick" | "eod", asOf: number, a: Account) {
  await c.query(
    `INSERT INTO experiment_equity(experiment_id,kind,as_of,equity,realized,unrealized,unpriced_positions,open_risk,peak,drawdown,daily_pnl,run_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [experimentId, kind, iso(asOf), a.equity, a.realized, a.unrealized, a.unpricedPositions, Math.max(0, a.openRisk), a.peak, Math.max(0, a.peak - a.equity), a.dailyPnl, runId],
  );
}

/** JSON has no Infinity/NaN; store them as null rather than failing the insert. */
function finite(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x)));
}
