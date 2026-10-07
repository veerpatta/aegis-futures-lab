/* The historical study's stages, resumable and bounded.

   register  freeze the register, manifest, measured observation delay and the
             three trial specifications (once; a rerun is a no-op)
   replay    one (symbol, month) chunk at a time, checkpointed; each job stops
             at its time cap, the whole replay at its active-minute budget, and
             a quota level at or above "stop" pauses it
   study     build the dataset, fix the split once, evaluate the registered
             trials, open the final period once for the selected candidate
   shadow    copy an eligible frozen candidate into the live experiment as a
             shadow version registered at its real time — never adopted here

   Every stage holds a lease, records a run, and is safe to retry. Nothing
   here buys data, calls a paid service or touches a ledger. */

import { createHash } from "node:crypto";
import type { Bar } from "@/lib/types";
import { stableHash } from "@/lib/experiment/hash";
import { specHash } from "@/lib/experiment/search";
import { HIST_RULES } from "./rules";
import { buildManifest, studyIdFor } from "./register";
import { checkBars } from "./quality";
import { monthBounds, replayChunk } from "./replay";
import { buildStudyDataset, splitSessions, type Split } from "./dataset";
import { evaluateTrial, finalEvaluation, selectTrial, type TrialResult } from "./study";
import type { ChunkRow, HistStage, HistoryStore, StudyRow } from "./store";

const DAY = 86400;
const BYTES_PER_BAR = 64;

export interface StageResult {
  stage: HistStage;
  status: "ok" | "partial" | "skipped" | "error";
  message: string;
  counts: Record<string, unknown>;
}

export interface StageInput {
  store: HistoryStore;
  stage: HistStage;
  invocationId: string;
  codeSha?: string | null;
  researchCodeHash?: string;
  nowSec?: number;
  maxChunks?: number;
  jobMinutes?: number;
  /** Live-experiment importer, injected so this module never imports the experiment store. */
  importShadow?: (input: { artifact: import("@/lib/experiment/types").LogitArtifact; spec: import("@/lib/experiment/types").ChallengerSpec; origin: Record<string, unknown> }) => Promise<{ versionId: string | null; message: string }>;
  rules?: typeof HIST_RULES;
}

export type QuotaGate = "normal" | "reduce" | "stop" | "essential" | "unknown";

export function quotaGate(q: { dbBytes: number | null; monthStudyBytes: number | null; monthRunSec: number | null; readAt: number }, nowSec: number, rules = HIST_RULES): QuotaGate {
  if (q.dbBytes === null || q.monthStudyBytes === null || nowSec - q.readAt > 3600) return "unknown";
  const share = Math.max(q.dbBytes / 1024 ** 3, q.monthStudyBytes / rules.budget.maxStudyEgressBytes);
  if (share >= rules.budget.quotaEssential) return "essential";
  if (share >= rules.budget.quotaStop) return "stop";
  if (share >= rules.budget.quotaReduce) return "reduce";
  return "normal";
}

export async function runStage(input: StageInput): Promise<StageResult> {
  const rules = input.rules ?? HIST_RULES;
  const { store, stage } = input;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const studyId = studyIdFor(rules);
  const holder = `${stage}:${input.invocationId}`;

  if (stage === "register") {
    const existing = await store.latestStudy(rules.version);
    if (existing) return { stage, status: "skipped", message: `Study ${existing.id} is already registered; registration is write-once.`, counts: { studyId: existing.id } };
    const facts = await store.registerFacts();
    const { manifest, manifestHash, trials } = buildManifest({ studyId, facts, researchCodeHash: input.researchCodeHash ?? "unknown", codeSha: input.codeSha ?? null, rules });
    await store.registerStudy({
      id: studyId, version: rules.version, rules: rules as unknown as Record<string, unknown>, rulesHash: stableHash(rules),
      manifest: manifest as unknown as Record<string, unknown>, manifestHash, codeSha: input.codeSha ?? null,
      researchCodeHash: input.researchCodeHash ?? "unknown", observationLagSec: manifest.observationLagSec, trials,
    });
    await store.insertTrials(studyId, trials.map((spec, i) => ({ ordinal: i + 1, spec, specHash: specHash(spec), status: "registered", folds: null, development: null, validation: null, reason: null })));
    return { stage, status: "ok", message: `Registered ${studyId}: ${manifest.plannedChunks} chunks planned, ${trials.length} trials frozen.`, counts: { studyId, manifestHash } };
  }

  const study = await store.latestStudy(rules.version);
  if (!study) return { stage, status: "skipped", message: "No study registered yet; run the register stage first.", counts: {} };
  const begun = await store.beginRun(study.id, stage, input.invocationId);
  if (begun.replayed) return { stage, status: "skipped", message: "This invocation already ran.", counts: {} };
  const started = Date.now();
  let bytes = 0;
  const finish = async (r: StageResult) => {
    await store.finishRun(begun.runId, { status: r.status, durationMs: Date.now() - started, bytesRead: bytes, counts: r.counts, message: r.message.slice(0, 500) });
    return r;
  };
  if (!(await store.acquireLease(study.id, holder, 20 * 60)))
    return finish({ stage, status: "skipped", message: "Another study job holds the lease.", counts: {} });
  try {
    if (stage === "replay") {
      const r = await replayStage(store, study, nowSec, input, rules, (b) => (bytes += b));
      return finish(r);
    }
    if (stage === "study") return finish(await studyStage(store, study, rules));
    return finish(await shadowStage(store, study, input, nowSec));
  } catch (err) {
    return finish({ stage, status: "error", message: err instanceof Error ? err.message : String(err), counts: {} });
  } finally {
    await store.releaseLease(study.id, holder).catch(() => {});
  }
}

async function replayStage(store: HistoryStore, study: StudyRow, nowSec: number, input: StageInput, rules: typeof HIST_RULES, addBytes: (b: number) => void): Promise<StageResult> {
  const manifest = study.manifest as { months: string[] };
  const done = await store.chunks(study.id);
  const doneKeys = new Set(done.filter((c) => c.status === "done").map((c) => `${c.symbol}:${c.month}`));
  // Active time = the recorded wall time of every earlier replay run (reads, replay AND writes), never a self-reported compute figure.
  const activeMs = Math.max(Number((study.budget as { replayActiveMs?: number }).replayActiveMs ?? 0), await store.replayRunMs(study.id));
  // Initial validation order: the newest covered MES month, then MNQ, then oldest-first for the rest.
  const order: { symbol: "MES" | "MNQ"; month: string }[] = [];
  const newest = manifest.months.at(-1)!;
  for (const s of rules.scope.symbols) order.push({ symbol: s, month: newest });
  for (const month of manifest.months) for (const s of rules.scope.symbols) if (month !== newest) order.push({ symbol: s, month });
  // A chunk that failed earlier is retried before any new month is opened.
  const failedKeys = new Set(done.filter((c) => c.status === "failed").map((c) => `${c.symbol}:${c.month}`));
  const open = order.filter((c) => !doneKeys.has(`${c.symbol}:${c.month}`));
  const pending = [...open.filter((c) => failedKeys.has(`${c.symbol}:${c.month}`)), ...open.filter((c) => !failedKeys.has(`${c.symbol}:${c.month}`))];
  if (!pending.length) {
    if (study.status !== "replayed" && study.status !== "evaluated") await store.updateStudy(study.id, { status: "replayed", statusReason: null });
    return { stage: "replay", status: "ok", message: "Replay complete.", counts: { pending: 0 } };
  }
  const q = await store.quotaInputs();
  const gate = quotaGate(q, nowSec, rules);
  if (gate === "unknown" || gate === "stop" || gate === "essential") {
    await store.updateStudy(study.id, { status: "partial", statusReason: gate === "unknown" ? "usage telemetry unavailable; replay paused" : `free allowance at the ${gate} level; replay paused` });
    return { stage: "replay", status: "skipped", message: `Replay paused: quota ${gate}.`, counts: { gate } };
  }
  if (activeMs >= rules.budget.initialBatchActiveMinutes * 60_000) {
    await store.updateStudy(study.id, { status: "partial", statusReason: `replay reached its ${rules.budget.initialBatchActiveMinutes}-minute active budget` });
    return { stage: "replay", status: "partial", message: "Replay budget used; partial result recorded.", counts: { activeMs } };
  }
  if (study.status === "registered") await store.updateStudy(study.id, { status: "replaying" });
  const ctx = await store.contextRows();
  const jobMs = Math.min(input.jobMinutes ?? rules.budget.jobMinutes, rules.budget.jobMinutes) * 60_000; // the frozen cap wins
  const jobStart = Date.now();
  const deadline = jobStart + jobMs;
  const maxChunks = input.maxChunks ?? Infinity;
  let processed = 0, finished = 0, examplesTotal = 0, runMs = 0;
  const measured: { symbol: string; month: string; ms: number; bars: number }[] = [];
  for (const c of pending) {
    if (processed >= maxChunks || Date.now() > deadline) break;
    if (activeMs + (Date.now() - jobStart) >= rules.budget.initialBatchActiveMinutes * 60_000) break;
    const t0 = Date.now();
    const { start, end } = monthBounds(c.month);
    const from = start - rules.warmupDays * DAY, to = end + rules.tailDays * DAY;
    let row: ChunkRow;
    let examples: ReturnType<typeof replayChunk>["examples"] = [];
    try {
      const raw: Bar[] = await store.readBars(c.symbol, rules.scope.source, from, to, rules.budget.maxBarsPerRead);
      addBytes(raw.length * BYTES_PER_BAR);
      const { clean, report } = checkBars(raw, c.symbol, rules);
      const result = replayChunk({ bars: clean, symbol: c.symbol, month: c.month, ctx, lagSec: study.observationLagSec, flags: report.windows, rules });
      examples = result.examples;
      const inMonth = clean.filter((b) => b.time >= start && b.time < end);
      const { windows, ...q2 } = report;
      row = {
        symbol: c.symbol, month: c.month, status: "done", barsRead: raw.length, bytesRead: raw.length * BYTES_PER_BAR,
        barsHash: createHash("sha256").update(JSON.stringify(inMonth.map((b) => [b.time, b.open, b.high, b.low, b.close]))).digest("hex"),
        firstBar: inMonth[0]?.time ?? null, lastBar: inMonth.at(-1)?.time ?? null, quality: { ...q2, windows: windows.length },
        ideas: result.ideas, examples: examples.length, runtimeMs: Date.now() - t0, error: null,
      };
    } catch (err) {
      row = {
        symbol: c.symbol, month: c.month, status: "failed", barsRead: 0, bytesRead: 0, barsHash: null, firstBar: null, lastBar: null,
        quality: { bars: 0, ohlcBad: 0, duplicates: 0, unordered: 0, gaps: 0, missingBars: 0, discontinuities: 0 }, ideas: 0, examples: 0,
        runtimeMs: Date.now() - t0, error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      };
      examples = [];
    }
    await store.saveChunk(study.id, row, examples);
    processed++;
    if (row.status === "done") finished++;
    examplesTotal += examples.length;
    runMs = Date.now() - jobStart;
    measured.push({ symbol: c.symbol, month: c.month, ms: row.runtimeMs, bars: row.barsRead });
  }
  const remaining = pending.length - finished; // a failed chunk is still owed
  const budget = { ...study.budget, replayActiveMs: activeMs + runMs, lastJob: { chunks: processed, ms: runMs, measured: measured.slice(0, 4) } };
  await store.updateStudy(study.id, {
    budget, status: remaining ? "replaying" : "replayed", statusReason: remaining ? `${remaining} chunks left` : null,
  });
  return {
    stage: "replay", status: remaining ? "partial" : "ok", message: `${processed} chunk(s) replayed, ${examplesTotal} examples; ${remaining} left.`,
    counts: { processed, remaining, examples: examplesTotal, activeMs: activeMs + runMs, gate },
  };
}

async function studyStage(store: HistoryStore, study: StudyRow, rules: typeof HIST_RULES): Promise<StageResult> {
  if (study.status === "evaluated") return { stage: "study", status: "skipped", message: "The study is already evaluated; the final period opens once.", counts: {} };
  if (study.status !== "replayed") return { stage: "study", status: "skipped", message: `Replay is not complete (status ${study.status}).`, counts: {} };
  const examples = await store.examples(study.id);
  const cutoff = Math.floor(Date.parse(`${rules.scope.to}T23:59:59Z`) / 1000); // labels must exist by the end of the scope
  const ds = buildStudyDataset(examples, cutoff, rules.primaryMode);
  // Opportunity families: map legacy signal and shadow copies onto the replay families (count each idea once).
  const scopeFrom = Math.floor(Date.parse(`${rules.scope.from}T00:00:00Z`) / 1000);
  const legacy = await store.legacyKeys(scopeFrom, cutoff + 1);
  const families = new Set(examples.filter((e) => e.mode === rules.primaryMode).map((e) => e.familyId));
  const familyAudit = {
    legacySignalsInScope: legacy.signals.length,
    legacySignalsMatched: legacy.signals.filter((k) => families.has(k)).length,
    shadowRowsInScope: legacy.shadows.length,
    shadowRowsMatched: legacy.shadows.filter((k) => families.has(k)).length,
    note: "Legacy signals were computed on delayed Yahoo bars; the replay uses the Databento archive, so unmatched signals show feed differences, not lost ideas. Shadow rows belong to other research methods (not the tier streams), so they are not expected to match. Legacy outcomes are never used as labels.",
  };
  const datasetSummary = {
    rawExamples: ds.rawExamples, families: ds.families, rows: ds.rows.length, sessions: ds.sessions.length, exclusions: ds.exclusions,
    byStrategy: ds.byStrategy, bySymbol: ds.bySymbol, rowsHash: ds.rowsHash, mode: ds.mode, familyAudit,
  };
  if (ds.rows.length > rules.budget.maxExamplesPerFit) {
    await store.updateStudy(study.id, { status: "partial", statusReason: `dataset of ${ds.rows.length} exceeds the ${rules.budget.maxExamplesPerFit}-example budget` });
    return { stage: "study", status: "partial", message: "Dataset larger than the fit budget; recorded as partial.", counts: datasetSummary };
  }
  // Fix the split once, from the session list, before any outcome is read.
  let split = study.split as unknown as Split | null;
  if (!split) {
    split = splitSessions(ds, rules);
    if (!split) {
      await store.updateStudy(study.id, { status: "partial", statusReason: "too few eligible sessions to split", dataset: datasetSummary, datasetHash: ds.rowsHash });
      return { stage: "study", status: "partial", message: "Too few eligible sessions to split.", counts: datasetSummary };
    }
    await store.updateStudy(study.id, { split: split as unknown as Record<string, unknown>, dataset: datasetSummary, datasetHash: ds.rowsHash });
  }
  const trials = await store.trials(study.id);
  const results: TrialResult[] = [];
  for (const t of trials.sort((a, b) => a.ordinal - b.ordinal)) {
    const r = evaluateTrial(t.spec, t.ordinal, ds.rows, split, ds.extras, trials.length, rules);
    results.push(r);
    if (t.status === "registered")
      await store.updateTrial(study.id, t.ordinal, {
        status: r.status, folds: r.folds, development: r.development as unknown as Record<string, unknown>,
        validation: r.validation as unknown as Record<string, unknown>, reason: r.reason,
      });
  }
  const sel = selectTrial(results);
  if (!sel) {
    await store.updateStudy(study.id, { status: "evaluated", statusReason: "no trial passed fold coverage and validation; no candidate", finalAccessedAt: Math.floor(Date.now() / 1000) });
    return { stage: "study", status: "ok", message: "No candidate: every trial failed coverage or validation. No validated improvement yet.", counts: { ...datasetSummary, trials: results.map((r) => r.status) } };
  }
  await store.updateTrial(study.id, sel.ordinal, { status: "selected" });
  const fin = finalEvaluation(sel, ds.rows, split, ds.extras, { studyId: study.id, datasetHash: ds.rowsHash }, rules);
  const openedAt = Math.floor(Date.now() / 1000);
  if ("error" in fin) {
    await store.updateStudy(study.id, { status: "evaluated", statusReason: `final evaluation not possible: ${fin.error}`, finalAccessedAt: openedAt });
    return { stage: "study", status: "ok", message: `Selected trial ${sel.ordinal}, but ${fin.error}.`, counts: datasetSummary };
  }
  const trialRows = await store.trials(study.id);
  const trialId = trialRows.find((t) => t.ordinal === sel.ordinal)!.id!;
  await store.insertFinal(study.id, {
    trialId, artifact: fin.artifact, artifactHash: fin.artifactHash, trainCutoff: fin.trainCutoff, trainRows: fin.trainRows,
    metrics: fin.final as unknown as Record<string, unknown>, verdict: fin.verdict.verdict, reasons: fin.verdict.reasons, checks: fin.verdict.checks,
    developmentExposed: fin.developmentExposed, shadowEligible: fin.shadowEligible, shadowVersionId: null, shadowRegisteredAt: null,
  });
  await store.updateStudy(study.id, { status: "evaluated", statusReason: `final ${fin.verdict.verdict} (development-exposed)`, finalAccessedAt: openedAt });
  return {
    stage: "study", status: "ok",
    message: `Selected trial ${sel.ordinal}; final period ${fin.verdict.verdict} on ${fin.final.nOos} ideas (development-exposed). Shadow eligible: ${fin.shadowEligible}.`,
    counts: { ...datasetSummary, trials: results.map((r) => r.status), verdict: fin.verdict.verdict },
  };
}

async function shadowStage(store: HistoryStore, study: StudyRow, input: StageInput, nowSec: number): Promise<StageResult> {
  const fin = await store.final(study.id);
  if (!fin) return { stage: "shadow", status: "skipped", message: "No final candidate to register.", counts: {} };
  if (fin.shadowVersionId) return { stage: "shadow", status: "skipped", message: `Already shadowing as ${fin.shadowVersionId}.`, counts: {} };
  if (!fin.shadowEligible) return { stage: "shadow", status: "skipped", message: `Not registered for shadow: final verdict ${fin.verdict}.`, counts: { verdict: fin.verdict } };
  if (!input.importShadow) return { stage: "shadow", status: "skipped", message: "No importer configured.", counts: {} };
  const trials = await store.trials(study.id);
  const spec = trials.find((t) => t.ordinal === fin.trialOrdinal)!.spec;
  const res = await input.importShadow({
    artifact: fin.artifact, spec,
    origin: {
      studyId: study.id, studyVersion: study.version, datasetHash: study.datasetHash, artifactHash: fin.artifactHash,
      trainCutoff: new Date(fin.trainCutoff * 1000).toISOString(), finalVerdict: fin.verdict, developmentExposed: fin.developmentExposed,
      rulesVersion: study.version, manifestHash: study.manifestHash,
    },
  });
  if (res.versionId) await store.setShadow(study.id, res.versionId, nowSec);
  return { stage: "shadow", status: res.versionId ? "ok" : "skipped", message: res.message, counts: { versionId: res.versionId } };
}
