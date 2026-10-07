/* In-memory HistoryStore for tests: the same write-once rules the database
   triggers enforce, so job tests exercise the real contract. */

import type { Bar } from "@/lib/types";
import type { ReplayExample, ContextRowLike } from "./replay";
import type { ChunkRow, FinalRow, HistStage, HistoryStore, RegisterFacts, StudyRow, TrialRow } from "./store";

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryHistoryStore implements HistoryStore {
  studies = new Map<string, StudyRow>();
  runs: { id: number; studyId: string; stage: string; invocationId: string; status: string; bytes: number; durationMs: number }[] = [];
  lease = new Map<string, { holder: string; expires: number }>();
  chunkRows = new Map<string, ChunkRow>();
  exampleRows = new Map<string, ReplayExample>();
  trialRows = new Map<string, TrialRow[]>();
  finals = new Map<string, FinalRow & { trialOrdinal: number }>();
  bars: Record<string, Bar[]> = {};
  ctx: ContextRowLike[] = [];
  facts: RegisterFacts | null = null;
  dbBytes: number | null = 400 * 1024 ** 2;
  telemetryAt: number | null = null;
  readCount = 0;
  failReadFor: string | null = null;

  async latestStudy(version: string) {
    const s = [...this.studies.values()].filter((x) => x.version === version).sort((a, b) => b.registeredAt - a.registeredAt)[0];
    return s ? clone(s) : null;
  }
  async registerStudy(s: Parameters<HistoryStore["registerStudy"]>[0]) {
    if (this.studies.has(s.id)) throw new Error("study exists");
    this.studies.set(s.id, { ...clone(s), status: "registered", statusReason: null, split: null, dataset: null, datasetHash: null, finalAccessedAt: null, budget: {}, registeredAt: Math.floor(Date.now() / 1000) });
  }
  async updateStudy(id: string, p: Parameters<HistoryStore["updateStudy"]>[1]) {
    const s = this.studies.get(id)!;
    if (s.split && p.split !== undefined && JSON.stringify(p.split) !== JSON.stringify(s.split)) throw new Error("A study's split is fixed once");
    if (s.datasetHash && p.datasetHash !== undefined && p.datasetHash !== s.datasetHash) throw new Error("A study's dataset is frozen once built");
    if (s.finalAccessedAt !== null && p.finalAccessedAt !== undefined && p.finalAccessedAt !== s.finalAccessedAt) throw new Error("The final period is opened once");
    if (s.status === "evaluated" && p.status && p.status !== "evaluated") throw new Error("An evaluated study is final");
    Object.assign(s, clone(p));
  }
  async registerFacts() {
    if (!this.facts) throw new Error("no facts");
    return clone(this.facts);
  }
  async beginRun(studyId: string, stage: HistStage, invocationId: string) {
    const ex = this.runs.find((r) => r.studyId === studyId && r.stage === stage && r.invocationId === invocationId);
    if (ex && ex.status !== "running" && ex.status !== "error") return { runId: ex.id, replayed: true };
    const run = { id: this.runs.length + 1, studyId, stage, invocationId: ex ? `${invocationId}:retry` : invocationId, status: "running", bytes: 0, durationMs: 0 };
    this.runs.push(run);
    return { runId: run.id, replayed: false };
  }
  async finishRun(runId: number, r: Parameters<HistoryStore["finishRun"]>[1]) {
    Object.assign(this.runs.find((x) => x.id === runId)!, { status: r.status, bytes: r.bytesRead, durationMs: r.durationMs });
  }
  async acquireLease(studyId: string, holder: string, ttlSec: number) {
    const now = Date.now() / 1000;
    const cur = this.lease.get(studyId);
    if (cur && cur.expires > now && cur.holder !== holder) return false;
    this.lease.set(studyId, { holder, expires: now + ttlSec });
    return true;
  }
  async releaseLease(studyId: string, holder: string) {
    if (this.lease.get(studyId)?.holder === holder) this.lease.delete(studyId);
  }
  async chunks(studyId: string) {
    return [...this.chunkRows.entries()].filter(([k]) => k.startsWith(`${studyId}|`)).map(([, v]) => clone(v));
  }
  async readBars(symbol: "MES" | "MNQ", source: string, fromSec: number, toSec: number, limit: number) {
    this.readCount++;
    if (this.failReadFor && this.failReadFor === symbol) throw new Error("simulated read failure");
    const out = (this.bars[`${source}:${symbol}`] ?? []).filter((b) => b.time >= fromSec && b.time < toSec);
    if (out.length > limit) throw new Error(`read of ${symbol} exceeds the ${limit}-bar cap`);
    return clone(out);
  }
  async contextRows() { return clone(this.ctx); }
  async saveChunk(studyId: string, c: ChunkRow, examples: ReplayExample[]) {
    const key = `${studyId}|${c.symbol}|${c.month}`;
    if (this.chunkRows.get(key)?.status === "done") throw new Error("A finished chunk is write-once");
    for (const e of examples) {
      const k = `${studyId}|${e.mode}|${e.familyId}`;
      if (!this.exampleRows.has(k)) this.exampleRows.set(k, clone(e));
    }
    this.chunkRows.set(key, clone(c));
  }
  async examples(studyId: string) {
    return [...this.exampleRows.entries()].filter(([k]) => k.startsWith(`${studyId}|`)).map(([, v]) => clone(v)).sort((a, b) => a.decidedAt - b.decidedAt);
  }
  async trials(studyId: string) { return clone(this.trialRows.get(studyId) ?? []); }
  async insertTrials(studyId: string, trials: TrialRow[]) {
    const cur = this.trialRows.get(studyId) ?? [];
    for (const t of trials) {
      if (cur.length >= 3) throw new Error("A study registers at most three trials");
      if (!cur.some((x) => x.specHash === t.specHash)) cur.push({ ...clone(t), id: cur.length + 1 });
    }
    this.trialRows.set(studyId, cur);
  }
  async updateTrial(studyId: string, ordinal: number, p: Parameters<HistoryStore["updateTrial"]>[2]) {
    const t = (this.trialRows.get(studyId) ?? []).find((x) => x.ordinal === ordinal)!;
    if (t.status !== "registered" && !(t.status === "evaluated" && p.status === "selected" && Object.keys(p).length === 1)) throw new Error("A measured trial is write-once");
    Object.assign(t, clone(p));
  }
  async final(studyId: string) { const f = this.finals.get(studyId); return f ? clone(f) : null; }
  async insertFinal(studyId: string, f: FinalRow) {
    if (this.finals.has(studyId)) throw new Error("A final result is write-once");
    const ordinal = (this.trialRows.get(studyId) ?? []).find((t) => t.id === f.trialId)!.ordinal;
    this.finals.set(studyId, { ...clone(f), trialOrdinal: ordinal });
  }
  async setShadow(studyId: string, versionId: string, at: number) {
    const f = this.finals.get(studyId)!;
    if (f.shadowVersionId) throw new Error("A shadow registration is write-once");
    f.shadowVersionId = versionId;
    f.shadowRegisteredAt = at;
  }
  legacy: { signals: string[]; shadows: string[] } = { signals: [], shadows: [] };
  async legacyKeys() { return clone(this.legacy); }
  async quotaInputs() {
    return {
      dbBytes: this.dbBytes, monthStudyBytes: this.runs.reduce((a, r) => a + r.bytes, 0), monthRunSec: this.runs.reduce((a, r) => a + r.durationMs / 1000, 0),
      readAt: this.telemetryAt ?? Math.floor(Date.now() / 1000),
    };
  }
}
