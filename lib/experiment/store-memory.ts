/* In-memory ExperimentStore for tests and local synthetic campaigns. It keeps
   the same rules the database triggers enforce (append-only decisions, one
   decision per idea, finished trades write-once, pointer swaps need a change)
   so a test that passes here exercises the same contract. */

import type { Bar } from "@/lib/types";
import type { SignalRow } from "@/lib/neon/client";
import type {
  ChangeRecord, DatasetRecord, EvaluationRecord, ExperimentStore, LearnTx, PointerRecord, RunStatus, ShadowScoreRecord, TickState, TickTx, VersionRecord,
} from "./store";
import type { Account, Decision, ExperimentConfig, ExperimentStatus, ExpSymbol, Fill, Outcome, Position } from "./types";
import type { TickResult } from "./step";

interface Run { id: number; experimentId: string; job: string; invocationId: string; status: RunStatus; counts: Record<string, unknown>; message: string | null; durationMs: number }

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements ExperimentStore {
  experiments = new Map<string, ExperimentConfig>();
  accounts = new Map<string, Account>();
  positions = new Map<string, Position & { experimentId: string }>();
  outcomes = new Map<string, Outcome & { experimentId: string }>();
  decisions = new Map<string, Decision & { experimentId: string }>();
  fills = new Map<string, Fill>();
  versions = new Map<string, VersionRecord>();
  pointers = new Map<string, PointerRecord>();
  changes: (ChangeRecord & { id: number; experimentId: string; createdAt: number })[] = [];
  evaluations: (EvaluationRecord & { experimentId: string })[] = [];
  datasets: (DatasetRecord & { experimentId: string })[] = [];
  shadowScores: ShadowScoreRecord[] = [];
  equity: { experimentId: string; kind: string; asOf: number; account: Account }[] = [];
  runs: Run[] = [];
  bars: Partial<Record<ExpSymbol, Bar[]>> = {};
  signalRows: SignalRow[] = [];
  dbBytes: number | null = 50 * 1024 ** 2;
  locked = new Set<string>();
  /** Throw inside persist to simulate a crash before commit. */
  failNextPersist = false;

  async activeExperiment(lineage: string) {
    const all = [...this.experiments.values()].filter((e) => e.lineage === lineage);
    const running = all.filter((e) => e.status === "active" || e.status === "paused");
    const pick = (running.length ? running : all).sort((a, b) => b.campaign - a.campaign)[0];
    return pick ? clone(pick) : null;
  }

  async beginRun(r: { experimentId: string; job: string; invocationId: string }) {
    const existing = this.runs.find((x) => x.experimentId === r.experimentId && x.job === r.job && x.invocationId === r.invocationId);
    if (existing && existing.status !== "running" && existing.status !== "error") return { runId: existing.id, replay: { status: existing.status, counts: existing.counts, message: existing.message } };
    if (existing) return { runId: existing.id, replay: null };
    const run: Run = { id: this.runs.length + 1, experimentId: r.experimentId, job: r.job, invocationId: r.invocationId, status: "running", counts: {}, message: null, durationMs: 0 };
    this.runs.push(run);
    return { runId: run.id, replay: null };
  }

  async finishRun(runId: number, r: { status: RunStatus; counts: Record<string, unknown>; message: string | null; durationMs: number }) {
    const run = this.runs.find((x) => x.id === runId)!;
    Object.assign(run, { status: r.status, counts: r.counts, message: r.message, durationMs: r.durationMs });
  }

  async quotaInputs() {
    return { dbBytes: this.dbBytes, monthRunSec: this.runs.reduce((a, r) => a + r.durationMs / 1000, 0) };
  }

  private change(experimentId: string, c: ChangeRecord, at: number): number {
    const existing = this.changes.find((x) => x.eventKey === c.eventKey);
    if (existing) return existing.id;
    const id = this.changes.length + 1;
    this.changes.push({ ...clone(c), id, experimentId, createdAt: c.createdAt ?? at });
    return id;
  }

  private tickState(experimentId: string): TickState {
    return clone({
      exp: this.experiments.get(experimentId)!,
      account: this.accounts.get(experimentId)!,
      positions: [...this.positions.values()].filter((p) => p.experimentId === experimentId && (p.status === "open" || p.status === "pending_fill")),
      outcomes: [...this.outcomes.values()].filter((o) => o.experimentId === experimentId && (o.status === "pending" || o.status === "open")),
      pointer: this.pointers.get(experimentId)!,
      versions: [...this.versions.values()].filter((v) => v.experimentId === experimentId),
    });
  }

  private swap(experimentId: string, to: string, changeId: number, at: number, previous?: string | null) {
    const c = this.changes.find((x) => x.id === changeId);
    const cur = this.pointers.get(experimentId)!;
    if (!c || !["adopted", "rolled_back"].includes(c.kind) || c.fromVersion !== cur.versionId || c.toVersion !== to) throw new Error("A model switch needs a matching change");
    if (this.versions.get(to)?.experimentId !== experimentId) throw new Error("A model can only run inside its own experiment");
    this.pointers.set(experimentId, { versionId: to, previousVersionId: previous === undefined ? cur.versionId : previous, updatedAt: at });
  }

  async tick<T>(experimentId: string, work: (tx: TickTx) => Promise<T>): Promise<T | "busy"> {
    if (this.locked.has(experimentId)) return "busy";
    this.locked.add(experimentId);
    const snapshot = this.snapshot();
    try {
      const tx: TickTx = {
        load: async () => this.tickState(experimentId),
        bars: async (s, from, to) => clone((this.bars[s] ?? []).filter((b) => b.time >= from && b.time + 300 <= to)),
        signals: async (since) => clone(this.signalRows.filter((r) => Date.parse(r.signal_ts) / 1000 >= since)),
        decided: async (keys) => new Set(keys.filter((k) => [...this.decisions.values()].some((d) => d.experimentId === experimentId && d.opportunityKey === k))),
        persist: async (_runId, state, result, nowSec, writeEquity) => this.persist(experimentId, state, result, nowSec, writeEquity),
        rollback: async (change, to, at) => {
          const id = this.change(experimentId, change, at);
          this.swap(experimentId, to, id, at, null);
          this.versions.get(change.fromVersion!)!.status = "rolled_back";
          this.versions.get(to)!.status = "adopted";
        },
      };
      return await work(tx);
    } catch (err) {
      this.restore(snapshot);
      throw err;
    } finally {
      this.locked.delete(experimentId);
    }
  }

  private persist(experimentId: string, state: TickState, r: TickResult, nowSec: number, writeEquity: boolean) {
    if (this.failNextPersist) { this.failNextPersist = false; throw new Error("simulated crash before commit"); }
    for (const d of r.decisions) {
      if (this.decisions.has(d.key) || [...this.decisions.values()].some((x) => x.experimentId === experimentId && x.opportunityKey === d.opportunityKey))
        throw new Error(`duplicate decision ${d.key}`);
      this.decisions.set(d.key, { ...clone(d), experimentId });
    }
    for (const p of r.positions) {
      const old = this.positions.get(p.id);
      if (old && (old.status === "closed" || old.status === "cancelled")) throw new Error("A finished position is write-once");
      this.positions.set(p.id, { ...clone(p), experimentId });
    }
    for (const o of r.outcomes) {
      const old = this.outcomes.get(o.decisionKey);
      if (old && (old.status === "closed" || old.status === "void")) throw new Error("A finished outcome is write-once");
      this.outcomes.set(o.decisionKey, { ...clone(o), experimentId });
    }
    for (const f of r.fills) if (!this.fills.has(f.key)) this.fills.set(f.key, clone(f));
    for (const s of r.shadowScores) this.shadowScores.push(clone(s));
    for (const e of r.events) {
      const id = this.change(experimentId, {
        kind: e.kind, reason: e.reason, eventKey: `${e.kind}:${experimentId}:${e.at}`,
        fromStatus: e.kind === "locked" ? state.exp.status : null, toStatus: e.kind === "locked" ? "locked" : null,
      }, nowSec);
      if (e.kind === "locked") this.experiments.get(experimentId)!.status = "locked";
      void id;
    }
    this.accounts.set(experimentId, clone(r.account));
    if (writeEquity) this.equity.push({ experimentId, kind: "tick", asOf: nowSec, account: clone(r.account) });
  }

  async learner<T>(experimentId: string, _holder: string, work: (tx: LearnTx) => Promise<T>): Promise<T | "busy"> {
    const key = `${experimentId}:learner`;
    if (this.locked.has(key)) return "busy";
    this.locked.add(key);
    const snapshot = this.snapshot();
    try {
      const tx: LearnTx = {
        load: async () => clone({
          exp: this.experiments.get(experimentId)!,
          account: this.accounts.get(experimentId)!,
          decisions: [...this.decisions.values()].filter((d) => d.experimentId === experimentId),
          outcomes: [...this.outcomes.values()].filter((o) => o.experimentId === experimentId),
          versions: [...this.versions.values()].filter((v) => v.experimentId === experimentId),
          evaluations: this.evaluations.filter((e) => e.experimentId === experimentId),
          changes: this.changes.filter((c) => c.experimentId === experimentId),
          pointer: this.pointers.get(experimentId)!,
          shadowScores: this.shadowScores.filter((s) => this.decisions.get(s.decisionKey)?.experimentId === experimentId),
          latestDataset: this.datasets.filter((d) => d.experimentId === experimentId).at(-1) ?? null,
        }),
        insertDataset: async (_run, d) => { this.datasets.push({ ...clone(d), experimentId }); },
        insertVersion: async (v) => {
          if (this.versions.has(v.id) || [...this.versions.values()].some((x) => x.experimentId === experimentId && x.specHash === v.specHash)) throw new Error("spec already tried");
          if (v.kind === "logit" && [...this.versions.values()].filter((x) => x.experimentId === experimentId && x.weekKey === v.weekKey && x.kind === "logit").length >= 3)
            throw new Error("At most three challengers a week");
          this.versions.set(v.id, clone(v));
        },
        updateVersion: async (id, patch) => {
          const v = this.versions.get(id)!;
          if (v.artifact && patch.artifact && patch.artifact !== v.artifact) throw new Error("A trained model is write-once");
          Object.assign(v, clone(patch));
        },
        insertEvaluation: async (_run, e) => { this.evaluations.push({ ...clone(e), experimentId, id: this.evaluations.length + 1 }); },
        insertChange: async (c) => this.change(experimentId, c, c.createdAt ?? Math.floor(Date.now() / 1000)),
        swapPointer: async (to, changeId, at, previous) => this.swap(experimentId, to, changeId, at, previous),
        insertEquity: async (_run, kind, asOf, account) => { this.equity.push({ experimentId, kind, asOf, account: clone(account) }); },
      };
      return await work(tx);
    } catch (err) {
      this.restore(snapshot);
      throw err;
    } finally {
      this.locked.delete(key);
    }
  }

  async setStatus(experimentId: string, to: ExperimentStatus, change: ChangeRecord) {
    const exp = this.experiments.get(experimentId)!;
    if (exp.status === "stopped") throw new Error("A stopped experiment is write-once");
    if (exp.status === "locked" && to !== "stopped" && to !== "locked") throw new Error("A locked campaign never reopens");
    this.change(experimentId, { ...change, fromStatus: exp.status, toStatus: to }, Math.floor(Date.now() / 1000));
    exp.status = to;
  }

  async createExperiment(input: { exp: ExperimentConfig; v1: VersionRecord; reason: string }) {
    const { exp, v1 } = input;
    if (this.experiments.has(exp.id)) throw new Error("experiment exists");
    if ([...this.experiments.values()].some((e) => e.lineage === exp.lineage && (e.status === "active" || e.status === "paused")))
      throw new Error("A running campaign must be locked or stopped before a new one starts");
    this.experiments.set(exp.id, clone(exp));
    this.accounts.set(exp.id, {
      equity: exp.capital, realized: 0, unrealized: 0, unpricedPositions: 0, peak: exp.capital, dayKey: "", dayStartEquity: exp.capital, dailyPnl: 0,
      openRisk: 0, dayHalted: false, lockedAt: null, cursor: {}, staleSymbols: [], lastOkTickAt: null,
    });
    this.versions.set(v1.id, clone(v1));
    const id = this.change(exp.id, { kind: "campaign_started", toStatus: "active", toVersion: v1.id, reason: input.reason, eventKey: `campaign:${exp.id}` }, exp.startedAt);
    void id;
    this.pointers.set(exp.id, { versionId: v1.id, previousVersionId: null, updatedAt: exp.startedAt });
  }

  private snapshot() {
    return clone({
      experiments: [...this.experiments], accounts: [...this.accounts], positions: [...this.positions], outcomes: [...this.outcomes],
      decisions: [...this.decisions], fills: [...this.fills], versions: [...this.versions], pointers: [...this.pointers],
      changes: this.changes, evaluations: this.evaluations, datasets: this.datasets, shadowScores: this.shadowScores, equity: this.equity,
    });
  }

  private restore(s: ReturnType<MemoryStore["snapshot"]>) {
    this.experiments = new Map(s.experiments); this.accounts = new Map(s.accounts); this.positions = new Map(s.positions);
    this.outcomes = new Map(s.outcomes); this.decisions = new Map(s.decisions); this.fills = new Map(s.fills);
    this.versions = new Map(s.versions); this.pointers = new Map(s.pointers); this.changes = s.changes; this.evaluations = s.evaluations;
    this.datasets = s.datasets; this.shadowScores = s.shadowScores; this.equity = s.equity;
  }
}
