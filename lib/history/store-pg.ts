/* HistoryStore over Neon Postgres. Bar reads are read-only and always pin
   the source; writes go only to history_* tables (tests/history-isolation
   greps this file). Usage telemetry comes from the database itself. */

import type { Pool } from "pg";
import type { Bar } from "@/lib/types";
import type { ReplayExample, ContextRowLike } from "./replay";
import type { ChunkRow, FinalRow, HistStage, HistoryStore, RegisterFacts, StudyRow, TrialRow } from "./store";

type Row = Record<string, unknown>;
const sec = (v: unknown): number | null => (v == null ? null : Math.floor(new Date(v as string).getTime() / 1000));
const iso = (s: number | null | undefined): string | null => (s == null ? null : new Date(s * 1000).toISOString());
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const json = (v: unknown) => (v == null ? null : JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x)));

function studyFromRow(r: Row): StudyRow {
  return {
    id: String(r.id), version: String(r.version), status: r.status as StudyRow["status"], statusReason: (r.status_reason as string) ?? null,
    rules: r.rules as Record<string, unknown>, rulesHash: String(r.rules_hash), manifest: r.manifest as Record<string, unknown>, manifestHash: String(r.manifest_hash),
    codeSha: (r.code_sha as string) ?? null, researchCodeHash: String(r.research_code_hash), observationLagSec: Number(r.observation_lag_sec),
    trials: r.trials as StudyRow["trials"], split: (r.split as Record<string, unknown>) ?? null, dataset: (r.dataset as Record<string, unknown>) ?? null,
    datasetHash: (r.dataset_hash as string) ?? null, finalAccessedAt: sec(r.final_accessed_at), budget: (r.budget as Record<string, unknown>) ?? {},
    registeredAt: sec(r.registered_at)!,
  };
}

function exampleFromRow(r: Row): ReplayExample {
  return {
    mode: r.mode as ReplayExample["mode"], familyId: String(r.family_id), month: String(r.month), symbol: r.symbol as ReplayExample["symbol"],
    side: r.side as ReplayExample["side"], strategy: String(r.strategy), tier: String(r.tier), signalTs: sec(r.signal_ts)!, seenAt: sec(r.seen_at)!,
    decidedAt: sec(r.decided_at)!, infoCutoff: sec(r.info_cutoff)!, labelReadyAt: sec(r.label_ready_at), features: (r.features as ReplayExample["features"]) ?? null,
    reason: String(r.reason), outcomeStatus: r.outcome_status as ReplayExample["outcomeStatus"], voidReason: (r.void_reason as string) ?? null,
    standaloneQty: Number(r.standalone_qty), fillTs: sec(r.fill_ts), fillPrice: num(r.fill_price), exitTs: sec(r.exit_ts), exitPrice: num(r.exit_price),
    exitReason: (r.exit_reason as string) ?? null, ambiguous: !!r.ambiguous, grossPc: num(r.gross_pc), feesPc: num(r.fees_pc), slipPc: num(r.slip_pc),
    netPc: num(r.net_pc), riskPc: num(r.risk_pc), quality: (r.quality as string[]) ?? [], quarantined: !!r.quarantined, snapshotHash: String(r.snapshot_hash),
    ideaExitTs: sec(r.idea_exit_ts),
  };
}

function trialFromRow(r: Row): TrialRow {
  return {
    id: Number(r.id), ordinal: Number(r.ordinal), spec: r.spec as TrialRow["spec"], specHash: String(r.spec_hash), status: r.status as TrialRow["status"],
    folds: (r.folds as TrialRow["folds"]) ?? null, development: (r.development as Record<string, unknown>) ?? null,
    validation: (r.validation as Record<string, unknown>) ?? null, reason: (r.reason as string) ?? null,
  };
}

export class PgHistoryStore implements HistoryStore {
  constructor(private pool: Pool) {}

  async latestStudy(version: string) {
    const r = await this.pool.query("SELECT * FROM history_studies WHERE version=$1 ORDER BY registered_at DESC LIMIT 1", [version]);
    return r.rows[0] ? studyFromRow(r.rows[0]) : null;
  }

  async registerStudy(s: Parameters<HistoryStore["registerStudy"]>[0]) {
    await this.pool.query(
      `INSERT INTO history_studies(id,version,rules,rules_hash,manifest,manifest_hash,code_sha,research_code_hash,observation_lag_sec,trials)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.id, s.version, json(s.rules), s.rulesHash, json(s.manifest), s.manifestHash, s.codeSha, s.researchCodeHash, s.observationLagSec, json(s.trials)],
    );
  }

  async updateStudy(id: string, p: Parameters<HistoryStore["updateStudy"]>[1]) {
    const sets: string[] = [], vals: unknown[] = [id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (p.status !== undefined) add("status", p.status);
    if (p.statusReason !== undefined) add("status_reason", p.statusReason);
    if (p.split !== undefined) add("split", json(p.split));
    if (p.dataset !== undefined) add("dataset", json(p.dataset));
    if (p.datasetHash !== undefined) add("dataset_hash", p.datasetHash);
    if (p.finalAccessedAt !== undefined) add("final_accessed_at", iso(p.finalAccessedAt));
    if (p.budget !== undefined) add("budget", json(p.budget));
    if (sets.length) await this.pool.query(`UPDATE history_studies SET ${sets.join(",")}, updated_at=now() WHERE id=$1`, vals);
  }

  async registerFacts(): Promise<RegisterFacts> {
    const q = (sql: string, p: unknown[] = []) => this.pool.query(sql, p).then((r) => r.rows);
    const coverage = (await q(`SELECT source, symbol, to_char(to_timestamp(min(time)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') f,
        to_char(to_timestamp(max(time)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"') t, count(*)::bigint n FROM bars_5m GROUP BY source, symbol ORDER BY 1,2`))
      .map((r) => ({ source: String(r.source), symbol: String(r.symbol), from: String(r.f), to: String(r.t), rows: Number(r.n) }));
    const yahooOverlap = (await q(`SELECT y.symbol, count(*)::bigint n, count(*) FILTER (WHERE abs(y.close - d.close) > 0.5)::bigint bad,
        coalesce(max(abs(y.close - d.close)),0) mx FROM bars_5m y JOIN bars_5m d ON d.symbol=y.symbol AND d.time=y.time AND d.source='databento'
        WHERE y.source='yahoo' AND y.symbol IN ('MES','MNQ') GROUP BY y.symbol`))
      .map((r) => ({ symbol: String(r.symbol), overlapping: Number(r.n), mismatched: Number(r.bad), maxDiff: Number(r.mx) }));
    const sig = (await q(`SELECT count(*) n, count(pnl_usd) c, coalesce(sum(pnl_usd),0) net, min(signal_ts) f, max(signal_ts) l, min(created_at) fc FROM signals`))[0];
    const sh = (await q(`SELECT count(*) n, count(pnl_usd) c, coalesce(sum(pnl_usd),0) net, min(signal_ts) f, max(signal_ts) l FROM shadow_signals`))[0];
    const research: Record<string, number> = {};
    for (const t of ["research_trials", "research_baselines", "research_measurements", "research_confirmations", "research_observations", "learning_runs", "model_registry", "challenger_history", "engine_runs", "recovery_runs"]) {
      try { research[t] = Number((await q(`SELECT count(*) n FROM ${t}`))[0].n); } catch { research[t] = -1; }
    }
    const firstRun = (await q(`SELECT min(ran_at) t FROM engine_runs`))[0]?.t ?? null;
    let firstDecision: string | null = null, decisions = 0;
    try {
      const d = (await q(`SELECT min(decided_at) t, count(*) n FROM experiment_decisions`))[0];
      firstDecision = d?.t ?? null; decisions = Number(d?.n ?? 0);
    } catch { /* experiment not migrated */ }
    const lag = (await q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from created_at - signal_ts)) m,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY extract(epoch from created_at - signal_ts)) a,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY extract(epoch from created_at - signal_ts)) b, count(*) n
        FROM signals WHERE signal_ts >= '2026-07-20' AND created_at > signal_ts AND created_at - signal_ts < interval '6 hours'`))[0];
    const ctx = (await q(`SELECT min(date_key) f, max(date_key) t FROM context_daily WHERE vix IS NOT NULL`))[0];
    return {
      coverage, yahooOverlap,
      signals: { total: Number(sig.n), withOutcome: Number(sig.c), net: Number(sig.net), first: sig.f ? new Date(sig.f).toISOString() : null, last: sig.l ? new Date(sig.l).toISOString() : null, firstCreated: sig.fc ? new Date(sig.fc).toISOString() : null },
      shadows: { total: Number(sh.n), withOutcome: Number(sh.c), net: Number(sh.net), first: sh.f ? new Date(sh.f).toISOString() : null, last: sh.l ? new Date(sh.l).toISOString() : null },
      experimentDecisions: decisions, research,
      firstEngineRun: firstRun ? new Date(firstRun).toISOString() : null,
      firstExperimentDecision: firstDecision ? new Date(firstDecision).toISOString() : null,
      observationLag: { medianSec: Number(lag?.m ?? 1500), p25Sec: Number(lag?.a ?? 0), p75Sec: Number(lag?.b ?? 0), n: Number(lag?.n ?? 0) },
      contextCoverage: { from: ctx?.f ?? null, to: ctx?.t ?? null },
    };
  }

  async beginRun(studyId: string, stage: HistStage, invocationId: string) {
    const ins = await this.pool.query(
      `INSERT INTO history_runs(study_id,stage,invocation_id) VALUES($1,$2,$3) ON CONFLICT (study_id,stage,invocation_id) DO NOTHING RETURNING id`,
      [studyId, stage, invocationId]);
    if (ins.rows[0]) return { runId: Number(ins.rows[0].id), replayed: false };
    const ex = (await this.pool.query(`SELECT id, status FROM history_runs WHERE study_id=$1 AND stage=$2 AND invocation_id=$3`, [studyId, stage, invocationId])).rows[0];
    if (ex.status !== "running" && ex.status !== "error") return { runId: Number(ex.id), replayed: true };
    const retry = await this.pool.query(`INSERT INTO history_runs(study_id,stage,invocation_id) VALUES($1,$2,$3) RETURNING id`, [studyId, stage, `${invocationId}:retry:${Date.now()}`]);
    return { runId: Number(retry.rows[0].id), replayed: false };
  }

  async finishRun(runId: number, r: Parameters<HistoryStore["finishRun"]>[1]) {
    await this.pool.query(
      `UPDATE history_runs SET status=$2, finished_at=now(), duration_ms=$3, bytes_read=$4, counts=$5, message=$6 WHERE id=$1 AND finished_at IS NULL`,
      [runId, r.status, Math.round(r.durationMs), Math.round(r.bytesRead), json(r.counts), r.message]);
  }

  async acquireLease(studyId: string, holder: string, ttlSec: number) {
    const r = await this.pool.query(
      `INSERT INTO history_leases(study_id, holder, expires_at) VALUES($1,$2, now() + make_interval(secs => $3))
       ON CONFLICT (study_id) DO UPDATE SET holder=EXCLUDED.holder, expires_at=EXCLUDED.expires_at
       WHERE history_leases.expires_at < now() OR history_leases.holder = EXCLUDED.holder RETURNING holder`,
      [studyId, holder, ttlSec]);
    return !!r.rows[0];
  }

  async releaseLease(studyId: string, holder: string) {
    await this.pool.query(`DELETE FROM history_leases WHERE study_id=$1 AND holder=$2`, [studyId, holder]);
  }

  async chunks(studyId: string): Promise<ChunkRow[]> {
    return (await this.pool.query(`SELECT * FROM history_chunks WHERE study_id=$1`, [studyId])).rows.map((r) => ({
      symbol: r.symbol, month: r.month, status: r.status, barsRead: Number(r.bars_read), bytesRead: Number(r.bytes_read), barsHash: r.bars_hash,
      firstBar: num(r.first_bar), lastBar: num(r.last_bar), quality: r.quality, ideas: Number(r.ideas), examples: Number(r.examples),
      runtimeMs: Number(r.runtime_ms), error: r.error,
    }));
  }

  async readBars(symbol: "MES" | "MNQ", source: string, fromSec: number, toSec: number, limit: number): Promise<Bar[]> {
    const r = await this.pool.query(
      `SELECT time, open, high, low, close, volume FROM bars_5m WHERE symbol=$1 AND source=$2 AND time >= $3 AND time < $4 ORDER BY time LIMIT $5`,
      [symbol, source, fromSec, toSec, limit + 1]);
    if (r.rows.length > limit) throw new Error(`read of ${symbol} exceeds the ${limit}-bar cap`);
    return r.rows.map((x) => ({ time: Number(x.time), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume ?? 0) }));
  }

  async contextRows(): Promise<ContextRowLike[]> {
    return (await this.pool.query(`SELECT date_key, vix, dxy, tnx FROM context_daily ORDER BY date_key`)).rows.map((r) => ({
      date_key: String(r.date_key), vix: num(r.vix), dxy: num(r.dxy), tnx: num(r.tnx),
    }));
  }

  async saveChunk(studyId: string, c: ChunkRow, examples: ReplayExample[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of examples) {
        await client.query(
          `INSERT INTO history_examples(study_id,mode,family_id,month,symbol,side,strategy,tier,signal_ts,seen_at,decided_at,info_cutoff,label_ready_at,features,
            reason,outcome_status,void_reason,standalone_qty,fill_ts,fill_price,exit_ts,exit_price,exit_reason,ambiguous,gross_pc,fees_pc,slip_pc,net_pc,risk_pc,
            quality,quarantined,snapshot_hash,idea_exit_ts)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
           ON CONFLICT (study_id,mode,family_id) DO NOTHING`,
          [studyId, e.mode, e.familyId, e.month, e.symbol, e.side, e.strategy, e.tier, iso(e.signalTs), iso(e.seenAt), iso(e.decidedAt), iso(e.infoCutoff),
            iso(e.labelReadyAt), json(e.features), e.reason, e.outcomeStatus, e.voidReason, e.standaloneQty, iso(e.fillTs), e.fillPrice, iso(e.exitTs),
            e.exitPrice, e.exitReason, e.ambiguous, e.grossPc, e.feesPc, e.slipPc, e.netPc, e.riskPc, e.quality, e.quarantined, e.snapshotHash, iso(e.ideaExitTs)]);
      }
      await client.query(
        `INSERT INTO history_chunks(study_id,symbol,month,status,bars_read,bytes_read,bars_hash,first_bar,last_bar,quality,ideas,examples,runtime_ms,error)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (study_id,symbol,month) DO UPDATE SET status=EXCLUDED.status, bars_read=EXCLUDED.bars_read, bytes_read=EXCLUDED.bytes_read,
           bars_hash=EXCLUDED.bars_hash, first_bar=EXCLUDED.first_bar, last_bar=EXCLUDED.last_bar, quality=EXCLUDED.quality, ideas=EXCLUDED.ideas,
           examples=EXCLUDED.examples, runtime_ms=EXCLUDED.runtime_ms, error=EXCLUDED.error, attempts=history_chunks.attempts+1, finished_at=now()`,
        [studyId, c.symbol, c.month, c.status, c.barsRead, c.bytesRead, c.barsHash, c.firstBar, c.lastBar, json(c.quality), c.ideas, c.examples, c.runtimeMs, c.error]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async examples(studyId: string): Promise<ReplayExample[]> {
    return (await this.pool.query(`SELECT * FROM history_examples WHERE study_id=$1 ORDER BY decided_at, id`, [studyId])).rows.map(exampleFromRow);
  }

  async trials(studyId: string): Promise<TrialRow[]> {
    return (await this.pool.query(`SELECT * FROM history_trials WHERE study_id=$1 ORDER BY ordinal`, [studyId])).rows.map(trialFromRow);
  }

  async insertTrials(studyId: string, trials: TrialRow[]) {
    for (const t of trials)
      await this.pool.query(`INSERT INTO history_trials(study_id,ordinal,spec,spec_hash,status) VALUES($1,$2,$3,$4,'registered') ON CONFLICT DO NOTHING`,
        [studyId, t.ordinal, json(t.spec), t.specHash]);
  }

  async updateTrial(studyId: string, ordinal: number, p: Parameters<HistoryStore["updateTrial"]>[2]) {
    const sets: string[] = [], vals: unknown[] = [studyId, ordinal];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (p.status !== undefined) add("status", p.status);
    if (p.folds !== undefined) add("folds", json(p.folds));
    if (p.development !== undefined) add("development", json(p.development));
    if (p.validation !== undefined) add("validation", json(p.validation));
    if (p.reason !== undefined) add("reason", p.reason);
    if (sets.length) await this.pool.query(`UPDATE history_trials SET ${sets.join(",")}, evaluated_at=coalesce(evaluated_at, now()) WHERE study_id=$1 AND ordinal=$2`, vals);
  }

  async final(studyId: string) {
    const r = (await this.pool.query(`SELECT f.*, t.ordinal FROM history_finals f JOIN history_trials t ON t.id=f.trial_id WHERE f.study_id=$1`, [studyId])).rows[0];
    if (!r) return null;
    return {
      trialId: Number(r.trial_id), trialOrdinal: Number(r.ordinal), artifact: r.artifact, artifactHash: String(r.artifact_hash), trainCutoff: sec(r.train_cutoff)!,
      trainRows: Number(r.train_rows), metrics: r.metrics, verdict: r.verdict, reasons: r.reasons ?? [], checks: r.checks ?? {},
      developmentExposed: !!r.development_exposed, shadowEligible: !!r.shadow_eligible, shadowVersionId: r.shadow_version_id ?? null,
      shadowRegisteredAt: sec(r.shadow_registered_at),
    } as FinalRow & { trialOrdinal: number };
  }

  async insertFinal(studyId: string, f: FinalRow) {
    await this.pool.query(
      `INSERT INTO history_finals(study_id,trial_id,artifact,artifact_hash,train_cutoff,train_rows,metrics,verdict,reasons,checks,development_exposed,shadow_eligible)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [studyId, f.trialId, json(f.artifact), f.artifactHash, iso(f.trainCutoff), f.trainRows, json(f.metrics), f.verdict, f.reasons, json(f.checks), f.developmentExposed, f.shadowEligible]);
  }

  async setShadow(studyId: string, versionId: string, at: number) {
    await this.pool.query(`UPDATE history_finals SET shadow_version_id=$2, shadow_registered_at=$3 WHERE study_id=$1 AND shadow_version_id IS NULL`, [studyId, versionId, iso(at)]);
  }

  async legacyKeys(fromSec: number, toSec: number) {
    const q = (t: string) => this.pool.query(`SELECT dedupe_key FROM ${t} WHERE signal_ts >= to_timestamp($1) AND signal_ts < to_timestamp($2) AND symbol IN ('MES','MNQ')`, [fromSec, toSec]).then((r) => r.rows.map((x) => String(x.dedupe_key)));
    return { signals: await q("signals"), shadows: await q("shadow_signals") };
  }

  async quotaInputs() {
    const r = (await this.pool.query(`SELECT pg_database_size(current_database())::bigint db,
        (SELECT coalesce(sum(bytes_read),0) FROM history_runs WHERE started_at >= date_trunc('month', now())) b,
        (SELECT coalesce(sum(duration_ms),0)/1000.0 FROM history_runs WHERE started_at >= date_trunc('month', now())) s`)).rows[0];
    return { dbBytes: num(r?.db), monthStudyBytes: num(r?.b), monthRunSec: num(r?.s), readAt: Math.floor(Date.now() / 1000) };
  }
}
