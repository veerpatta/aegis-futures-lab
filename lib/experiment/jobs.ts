/* The experimental learner's three jobs, runtime-agnostic. The Neon Function
   (functions/aegisexp/index.ts), the GitHub fallback (scripts/experiment/run.ts)
   and the tests all call runJob.

   - tick   (every 15 min): replay new bars, manage trades, decide new ideas.
   - learn  (nightly):      build the versioned dataset, run the rollback monitor,
                             write the end-of-day equity row.
   - review (weekly):       judge shadowing challengers, adopt at most one, then
                             register and train up to three new ones.

   Retries are safe: a run is keyed by its invocation id, the tick holds a
   per-experiment advisory lock and advances a cursor in the same transaction
   as the ledger, and every decision has a unique key. Nothing here spends
   money: no paid data, no paid AI, no purchases (tests/experiment-free-mode). */

import type { Bar } from "@/lib/types";
import { engineScheduled } from "@/lib/time/session";
import { stepTick, type ScoredModel, type TickResult } from "./step";
import { opportunitiesFromSignals } from "./opportunities";
import { syntheticBars, syntheticOpportunities } from "./synthetic";
import { ModelOutputError, TAKE_ALL_V1, artifactHash, trainChallenger, validateArtifact } from "./models";
import { quotaLevel, allowed, searchBudget, type QuotaLevel } from "./quota";
import { PREREG } from "./prereg";
import { walkForward, verdictOf, adoptionDecision, rollbackDecision, type EvalRow } from "./evaluate";
import { brier } from "./stats";
import { buildEvalRows, datasetFor, freshWindow, postAdoptionRows, weekKeyOf } from "./learning";
import { pickChallengers, specHash, inSearchSpace } from "./search";
import { stableHash } from "./hash";
import { EXP_RISK } from "./policy";
import type { ChangeRecord, ExperimentStore, JobName, LearnTx, TickTx, Trigger, VersionRecord } from "./store";
import type { ChallengerSpec, ExperimentConfig, ExpSymbol, LogitArtifact, Opportunity } from "./types";
import { EXP_SYMBOLS } from "./types";

const DAY = 86400;
const WARMUP_SEC = 3 * DAY;
const SIGNAL_WINDOW_SEC = 8 * DAY;

export interface JobInput {
  job: JobName;
  invocationId: string;
  trigger: Trigger;
  store: ExperimentStore;
  lineage?: string;
  scheduledAt?: number | null;
  nowSec?: number;
  codeSha?: string | null;
  /** Run even when the engine schedule says the market is shut (tests, replays). */
  ignoreSchedule?: boolean;
}

export interface JobResult {
  job: JobName;
  experimentId: string | null;
  status: "ok" | "skipped" | "busy" | "error" | "replayed";
  message: string;
  counts: Record<string, unknown>;
}

export async function runJob(input: JobInput): Promise<JobResult> {
  const { store, job } = input;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const exp = await store.activeExperiment(input.lineage ?? "learner");
  if (!exp) return { job, experimentId: null, status: "skipped", message: "No experiment is registered for this lineage.", counts: {} };
  const started = Date.now();
  const begun = await store.beginRun({
    experimentId: exp.id, job, invocationId: input.invocationId, trigger: input.trigger, scheduledAt: input.scheduledAt ?? null, codeSha: input.codeSha ?? null,
  });
  if (begun.replay) return { job, experimentId: exp.id, status: "replayed", message: begun.replay.message ?? "Already ran for this invocation.", counts: begun.replay.counts };
  const q = await store.quotaInputs();
  const level = quotaLevel(q);
  try {
    let out: { status: "ok" | "skipped"; message: string; counts: Record<string, unknown> } | "busy";
    if (job === "tick") out = await tickJob(store, exp, begun.runId, nowSec, level, !!input.ignoreSchedule);
    else if (job === "learn") out = await learnJob(store, exp, begun.runId, nowSec, level, input.invocationId);
    else out = await reviewJob(store, exp, begun.runId, nowSec, level, input.invocationId);
    if (out === "busy") {
      await store.finishRun(begun.runId, { status: "skipped", counts: {}, message: "Another run holds the lock.", durationMs: Date.now() - started, quotaLevel: level, dbBytes: q.dbBytes });
      return { job, experimentId: exp.id, status: "busy", message: "Another run holds the lock.", counts: {} };
    }
    await store.finishRun(begun.runId, { status: out.status, counts: out.counts, message: out.message, durationMs: Date.now() - started, quotaLevel: level, dbBytes: q.dbBytes });
    return { job, experimentId: exp.id, ...out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.finishRun(begun.runId, { status: "error", counts: {}, message: message.slice(0, 500), durationMs: Date.now() - started, quotaLevel: level, dbBytes: q.dbBytes }).catch(() => {});
    return { job, experimentId: exp.id, status: "error", message, counts: {} };
  }
}

// ── tick ──────────────────────────────────────────────────────────────────

function modelOf(versions: VersionRecord[], id: string): ScoredModel | null {
  const v = versions.find((x) => x.id === id);
  if (!v?.artifact || validateArtifact(v.artifact).length) return null;
  return { versionId: v.id, artifact: v.artifact };
}

async function tickJob(store: ExperimentStore, exp: ExperimentConfig, runId: number, nowSec: number, level: QuotaLevel, ignoreSchedule: boolean) {
  if (exp.mode === "live" && !ignoreSchedule && !engineScheduled(nowSec))
    return { status: "skipped" as const, message: "Market closed; nothing scheduled.", counts: {} };
  return store.tick(exp.id, async (tx) => {
    let state = await tx.load();
    const bars: Partial<Record<ExpSymbol, Bar[]>> = {};
    for (const s of EXP_SYMBOLS) {
      const cursor = state.account.cursor[s] ?? state.exp.startedAt;
      const from = Math.max(0, cursor - WARMUP_SEC);
      bars[s] = state.exp.mode === "synthetic" ? syntheticBars(state.exp.seed, s, from, nowSec) : await tx.bars(s, from, nowSec);
    }
    let opportunities: Opportunity[];
    if (state.exp.mode === "synthetic") {
      const all = EXP_SYMBOLS.flatMap((s) => syntheticOpportunities(bars[s] ?? [], s))
        .filter((o) => o.signalTs >= state.exp.startedAt && o.seenAt <= nowSec && o.seenAt > nowSec - SIGNAL_WINDOW_SEC);
      const decided = await tx.decided(all.map((o) => o.key));
      opportunities = all.filter((o) => !decided.has(o.key)).sort((a, b) => a.signalTs - b.signalTs || a.key.localeCompare(b.key));
    } else {
      const rows = await tx.signals(Math.max(state.exp.startedAt, nowSec - SIGNAL_WINDOW_SEC));
      const decided = await tx.decided(rows.map((r) => r.dedupe_key));
      opportunities = opportunitiesFromSignals(rows, state.exp.startedAt, decided, nowSec);
    }

    const counts: Record<string, unknown> = {};
    // An unusable active model is rolled back before it can decide anything.
    let model = modelOf(state.versions, state.pointer.versionId);
    if (!model) {
      await rollbackPointer(tx, state.pointer.versionId, state.pointer.previousVersionId, "invalid-artifact", nowSec);
      state = await tx.load();
      model = modelOf(state.versions, state.pointer.versionId) ?? { versionId: state.pointer.versionId, artifact: TAKE_ALL_V1 };
      counts.rolledBack = "invalid-artifact";
    }
    const challengers = state.versions.filter((v) => v.status === "shadowing").map((v) => modelOf(state.versions, v.id)).filter((m): m is ScoredModel => !!m);
    const input = {
      exp: state.exp, account: state.account, positions: state.positions, outcomes: state.outcomes, bars, opportunities, challengers, nowSec,
      provenance: state.exp.mode === "synthetic" ? ("synthetic" as const) : undefined, quota: level,
    };
    let result: TickResult;
    try {
      result = stepTick({ ...input, model });
    } catch (err) {
      if (!(err instanceof ModelOutputError)) throw err;
      await rollbackPointer(tx, state.pointer.versionId, state.pointer.previousVersionId, "invalid-output", nowSec);
      state = await tx.load();
      model = modelOf(state.versions, state.pointer.versionId) ?? { versionId: state.pointer.versionId, artifact: TAKE_ALL_V1 };
      result = stepTick({ ...input, model });
      counts.rolledBack = "invalid-output";
    }
    await tx.persist(runId, state, result, nowSec, allowed(level, "equity-row"));
    const reasons: Record<string, number> = {};
    for (const d of result.decisions) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    Object.assign(counts, {
      bars: result.barsProcessed, decisions: result.decisions.length, taken: result.newPositionIds.length, reasons,
      fills: result.fills.length, events: result.events.map((e) => e.kind), freshness: result.freshness, equity: result.account.equity, model: model.versionId,
    });
    const message = result.decisions.length
      ? `${result.decisions.length} idea(s) decided, ${result.newPositionIds.length} taken.`
      : result.barsProcessed ? "Watching; no new ideas." : "No new bars.";
    return { status: "ok" as const, message, counts };
  });
}

/** Point the experiment back at the previous model, or at the frozen v1
    control when there is none. The rolled-back version can never return. */
async function rollbackPointer(tx: TickTx | LearnTx, from: string, previous: string | null, reason: string, nowSec: number, evidence: Record<string, unknown> = {}) {
  const v1 = `${from.split(":")[0]}:v1-take-all`;
  const target = previous && previous !== from ? previous : v1;
  if (target === from) throw new Error(`The frozen control ${from} cannot be rolled back (${reason}).`);
  const change: ChangeRecord = {
    kind: "rolled_back", fromVersion: from, toVersion: target, reason, evidence, eventKey: `rollback:${from}:${nowSec}`,
  };
  if ("rollback" in tx) await tx.rollback(change, target, nowSec);
  else {
    const id = await tx.insertChange(change);
    await tx.swapPointer(target, id, nowSec, null);
    await tx.updateVersion(from, { status: "rolled_back", statusReason: reason });
    await tx.updateVersion(target, { status: "adopted", statusReason: `restored after ${reason}` });
  }
}

// ── learn ─────────────────────────────────────────────────────────────────

async function learnJob(store: ExperimentStore, exp: ExperimentConfig, runId: number, nowSec: number, level: QuotaLevel, invocationId: string) {
  if (!allowed(level, "learn")) return { status: "skipped" as const, message: "Free quota nearly used; learning waits for the reset.", counts: { quota: level } };
  return store.learner(exp.id, `learn:${invocationId}`, async (tx) => {
    const st = await tx.load();
    const allowSynthetic = st.exp.mode === "synthetic";
    const rows = buildEvalRows(st.decisions, st.outcomes, nowSec);
    const ds = datasetFor(st.exp.id, rows, nowSec);
    const counts: Record<string, unknown> = { rows: rows.length };
    if (!st.latestDataset || st.latestDataset.rowsHash !== ds.rowsHash) {
      await tx.insertDataset(runId, ds);
      counts.dataset = ds.id;
    } else counts.dataset = "unchanged";

    // Rollback monitor for an adopted challenger (never for the v1 control).
    const active = st.versions.find((v) => v.id === st.pointer.versionId);
    if (active?.kind === "logit") {
      const post = postAdoptionRows(active.id, st.pointer.updatedAt, st.decisions, rows, allowSynthetic);
      const priorMonitors = st.evaluations.filter((e) => e.kind === "monitor" && e.versionId === active.id).sort((a, b) => b.createdAt - a.createdAt);
      const base = post.length ? post.reduce((a, r) => a + r.y, 0) / post.length : NaN;
      const brierPost = brier(post.map((r) => r.p ?? base), post.map((r) => r.y));
      const brierBase = brier(post.map(() => base), post.map((r) => r.y));
      const worse = post.length >= PREREG.rollback.minPost && brierPost >= brierBase;
      let streak = worse ? 1 : 0;
      for (const m of priorMonitors) { if (m.metrics.brierWorse) streak++; else break; }
      const rb = rollbackDecision({ post, brierRegressions: streak, seedKey: `${active.id}:${weekKeyOf(nowSec)}` });
      await tx.insertEvaluation(runId, {
        versionId: active.id, incumbentVersionId: null, datasetId: counts.dataset === "unchanged" ? st.latestDataset?.id ?? null : ds.id, kind: "monitor",
        windowFrom: st.pointer.updatedAt, windowTo: nowSec, nOos: post.length, nSessions: new Set(post.map((r) => r.session)).size, totalOutcomes: rows.length,
        metrics: { brierPost, brierBase, brierWorse: worse, drawdown: rb.drawdown, deltaPost: rb.delta ?? null }, seeds: {},
        verdict: rb.rollback ? "fail" : post.length >= PREREG.rollback.minPost ? "pass" : "inconclusive", reasons: rb.reason ? [rb.reason] : [], createdAt: nowSec,
      });
      if (rb.rollback) {
        await rollbackPointer(tx, active.id, st.pointer.previousVersionId, rb.reason!, nowSec, { postRows: post.length, drawdown: rb.drawdown });
        counts.rolledBack = rb.reason;
      }
    }
    if (allowed(level, "equity-row")) await tx.insertEquity(runId, "eod", nowSec, st.account);
    return { status: "ok" as const, message: `Dataset of ${rows.length} closed outcome(s).`, counts };
  });
}

// ── review ────────────────────────────────────────────────────────────────

async function reviewJob(store: ExperimentStore, exp: ExperimentConfig, runId: number, nowSec: number, level: QuotaLevel, invocationId: string) {
  if (!allowed(level, "review")) return { status: "skipped" as const, message: "Free quota nearly used; the review waits for the reset.", counts: { quota: level } };
  return store.learner(exp.id, `review:${invocationId}`, async (tx) => {
    const st = await tx.load();
    const allowSynthetic = st.exp.mode === "synthetic";
    const weekKey = weekKeyOf(nowSec);
    const rows: EvalRow[] = buildEvalRows(st.decisions, st.outcomes, nowSec);
    const ds = datasetFor(st.exp.id, rows, nowSec);
    let datasetId = st.latestDataset?.id ?? null;
    if (!st.latestDataset || st.latestDataset.rowsHash !== ds.rowsHash) { await tx.insertDataset(runId, ds); datasetId = ds.id; }
    const counts: Record<string, unknown> = { rows: rows.length, week: weekKey };
    const incumbentVersion = st.versions.find((v) => v.id === st.pointer.versionId)!;
    const incumbent = incumbentVersion.artifact ?? TAKE_ALL_V1;

    // 1. Judge every shadowing challenger.
    const shadowing = st.versions.filter((v) => v.status === "shadowing" && v.artifact?.kind === "logit");
    const adoptable: { v: VersionRecord; lo: number }[] = [];
    const verdicts: Record<string, string> = {};
    for (const v of shadowing) {
      const spec = v.spec as ChallengerSpec;
      const wf = walkForward(rows, spec, incumbent, { seedKey: `${v.id}:${weekKey}`, comparisons: shadowing.length, allowSynthetic });
      const verdict = verdictOf(wf.metrics);
      const previous = st.evaluations.filter((e) => e.kind === "walk_forward" && e.versionId === v.id).sort((a, b) => b.createdAt - a.createdAt);
      const lastTotal = previous[0]?.totalOutcomes ?? rows.filter((r) => r.exitTs <= v.registeredAt).length;
      const newOutcomes = rows.length - lastTotal;
      const fresh = freshWindow(v.id, v.registeredAt, st.decisions, rows, st.shadowScores, allowSynthetic);
      const adoption = adoptionDecision({
        current: { at: nowSec, verdict: verdict.verdict, newOutcomes },
        previous: previous.map((e) => ({ at: e.createdAt, verdict: e.verdict, newOutcomes: Number(e.metrics.newOutcomes ?? 0) })),
        fresh, active: st.exp.status === "active",
      });
      await tx.insertEvaluation(runId, {
        versionId: v.id, incumbentVersionId: incumbentVersion.id, datasetId, kind: "walk_forward",
        windowFrom: rows[0]?.decidedAt ?? null, windowTo: nowSec, nOos: wf.metrics.nOos, nSessions: wf.metrics.nSessions, totalOutcomes: rows.length,
        metrics: { ...wf.metrics, newOutcomes, fresh: { sessions: fresh.sessions, decisions: fresh.decisions, deltaPerIdea: fresh.deltaPerIdea, netPerIdea: fresh.netPerIdea },
          adoptionBlockers: adoption.reasons, checks: verdict.checks },
        seeds: wf.seeds, verdict: verdict.verdict, reasons: verdict.reasons, createdAt: nowSec,
      });
      verdicts[v.id] = verdict.verdict;
      if (verdict.verdict === "fail" || verdict.verdict === "invalid") {
        const kind = verdict.verdict === "fail" ? "rejected" : "challenger_invalid";
        await tx.insertChange({ kind, fromVersion: v.id, reason: verdict.reasons.join(", ") || verdict.verdict, evidence: { metrics: summary(wf.metrics) }, eventKey: `${kind}:${v.id}:${weekKey}` });
        await tx.updateVersion(v.id, { status: verdict.verdict === "fail" ? "rejected" : "invalid", statusReason: verdict.reasons.join(", ") });
        continue;
      }
      if (adoption.adopt) { adoptable.push({ v, lo: wf.metrics.delta.lo }); continue; }
      const inconclusiveRun = [verdict.verdict, ...previous.map((e) => e.verdict)].findIndex((x) => x !== "inconclusive");
      const streak = inconclusiveRun === -1 ? previous.length + 1 : inconclusiveRun;
      const tooOld = nowSec - v.registeredAt > PREREG.lifecycle.shadowWeeks * 7 * DAY && verdict.verdict !== "pass";
      if (streak >= PREREG.lifecycle.maxInconclusive || tooOld) {
        await tx.insertChange({ kind: "retired", fromVersion: v.id, reason: tooOld ? "shadowed too long without passing" : "inconclusive too many times", eventKey: `retired:${v.id}:${weekKey}` });
        await tx.updateVersion(v.id, { status: "retired", statusReason: tooOld ? "shadow-expired" : "inconclusive-limit" });
      } else if (verdict.verdict === "inconclusive") {
        await tx.insertChange({ kind: "inconclusive", fromVersion: v.id, reason: verdict.reasons.join(", ") || "not enough evidence yet", evidence: { metrics: summary(wf.metrics) }, eventKey: `inconclusive:${v.id}:${weekKey}` });
      }
    }

    // 2. At most one adoption: the clearest gain.
    const best = adoptable.sort((a, b) => b.lo - a.lo)[0];
    if (best) {
      const changeId = await tx.insertChange({
        kind: "adopted", fromVersion: incumbentVersion.id, toVersion: best.v.id, reason: "every adoption check passed",
        evidence: { deltaLo: best.lo }, eventKey: `adopted:${best.v.id}`,
      });
      await tx.swapPointer(best.v.id, changeId, nowSec);
      await tx.updateVersion(best.v.id, { status: "adopted", statusReason: "passed walk-forward, fresh window and two reviews" });
      await tx.updateVersion(incumbentVersion.id, { status: "retired", statusReason: `replaced by ${best.v.id}` });
      counts.adopted = best.v.id;
    }

    // 3. Register and train new challengers inside the preregistered grid.
    const budget = searchBudget(level, PREREG.search.maxPerWeek) - st.versions.filter((v) => v.kind === "logit" && v.weekKey === weekKey).length;
    const trainRows = rows.map((r) => ({ features: r.features, win: r.win, net: r.net, sessionKey: r.session }));
    const registered: string[] = [];
    if (budget > 0 && trainRows.length >= PREREG.gates.minTrainRows) {
      const tried = new Set(st.versions.map((v) => v.specHash));
      for (const [i, spec] of pickChallengers(weekKey, tried, budget).entries()) {
        if (!inSearchSpace(spec)) continue;
        const id = `${st.exp.id}:${weekKey}:c${i + 1}`;
        const seed = PREREG.seed ^ i;
        const hash = specHash(spec);
        await tx.insertVersion({
          id, experimentId: st.exp.id, kind: "logit", spec, specHash: hash, weekKey, registeredAt: nowSec, datasetId, artifact: null, artifactHash: null,
          trainedAt: null, trainCutoff: nowSec, status: "registered", statusReason: null,
        });
        await tx.insertChange({ kind: "challenger_registered", toVersion: id, reason: `registered: ${JSON.stringify(spec)}`, evidence: { spec, seed, datasetId }, eventKey: `registered:${id}` });
        let artifact: LogitArtifact | null = null, problems: string[] = [];
        try {
          artifact = trainChallenger(id, spec, trainRows, { seed, cutoff: new Date(nowSec * 1000).toISOString(), datasetId, rowsHash: ds.rowsHash });
          problems = validateArtifact(artifact);
        } catch (err) {
          problems = [err instanceof Error ? err.message : String(err)];
        }
        if (artifact && !problems.length) {
          await tx.updateVersion(id, { artifact, artifactHash: artifactHash(artifact), trainedAt: nowSec, status: "shadowing", statusReason: `trained on ${artifact.train.n} outcomes` });
          registered.push(id);
        } else {
          await tx.updateVersion(id, { status: "invalid", statusReason: problems.join("; ") });
          await tx.insertChange({ kind: "challenger_invalid", fromVersion: id, reason: problems.join("; "), eventKey: `invalid:${id}` });
        }
      }
    } else if (budget > 0) counts.searchWaiting = `${trainRows.length} of ${PREREG.gates.minTrainRows} closed outcomes needed to train`;
    counts.verdicts = verdicts;
    counts.registered = registered;
    const message = best ? `Adopted ${best.v.id}.` : shadowing.length ? `Reviewed ${shadowing.length} challenger(s); no change applied.` : "No challenger to review yet.";
    return { status: "ok" as const, message, counts };
  });
}

function summary(m: { nOos: number; delta: { est: number; lo: number; hi: number }; expectancy: { est: number }; randomPct: number; brierC: number; brierInc: number }) {
  return { nOos: m.nOos, delta: m.delta, expectancy: m.expectancy.est, randomPct: m.randomPct, brierC: m.brierC, brierInc: m.brierInc };
}

// ── campaigns ─────────────────────────────────────────────────────────────

/** Preregister a campaign. A new campaign never resets an old one: the old
    one must be locked or stopped first, and its losses stay in the lifetime
    totals. */
export async function createCampaign(store: ExperimentStore, input: {
  lineage: string; campaign: number; mode: "live" | "synthetic"; startedAt: number; reason: string; seed?: number;
}): Promise<ExperimentConfig> {
  const id = `${input.lineage}-${input.campaign}`;
  const exp: ExperimentConfig = {
    id, lineage: input.lineage, campaign: input.campaign, mode: input.mode, status: "active", capital: EXP_RISK.capital,
    startedAt: input.startedAt, seed: input.seed ?? PREREG.seed,
  };
  const v1: VersionRecord = {
    id: `${id}:v1-take-all`, experimentId: id, kind: "take_all", spec: {}, specHash: stableHash({ kind: "take_all" }), weekKey: weekKeyOf(input.startedAt),
    registeredAt: input.startedAt, datasetId: null, artifact: TAKE_ALL_V1, artifactHash: artifactHash(TAKE_ALL_V1), trainedAt: null, trainCutoff: null,
    status: "adopted", statusReason: "frozen control",
  };
  await store.createExperiment({ exp, risk: { ...EXP_RISK }, prereg: { ...PREREG }, preregHash: stableHash(PREREG), v1, reason: input.reason });
  return exp;
}
