import { describe, expect, it, vi } from "vitest";
import { FreeAiError, type ChatRequest, type ChatResult } from "@/lib/ai-free/nvidia";
import { ABANDONED_CLAIM_SECONDS, CALLS_PER_STUDY, JUDGE_MEMORY, MAX_ATTEMPTS, PROBE_TIMEOUT_MS, runJudge, type JudgeDecisionRow, type JudgeStore, type JudgeStudyRow } from "@/lib/ai-judge/runner";
import type { StoredLook } from "@/lib/ai-judge/looks";
import type { JudgeLookResult, JudgeScoreRow } from "@/lib/ai-judge/score";
import { DEEPSEEK_JUDGE_STUDY, judgeConfigHash, KIMI_JUDGE_STUDY, MODEL_PROBE_INTERVAL_MS, NEMOTRON_JUDGE_STUDY } from "@/lib/ai-judge/studies";

const T0 = Date.parse("2026-11-09T15:00:00Z");
const cutoff = Date.parse("2026-11-09T14:40:00Z") / 1000;

function decision(key: string, createdAt: number): JudgeDecisionRow {
  return {
    decisionKey: key, symbol: "MES", side: "SHORT", sessionKey: "2026-11-09", infoCutoff: cutoff, createdAt, attempts: 0,
    idea: { entry: 7437.75, stop: 7460.4, target: 7403.78, rr: 1.5, strategy: "rsi-reversion", sourcePaused: true, decisionEvidence: { contractRisk: 111.89 } },
    features: { regime: "range-high-vol", vix_bucket: "high", atr_pct: 0.18, vwap_atr: 4.6 },
  };
}

type Ev = { study: string; key: string; kind: string; attempt?: number; at: number; payload?: Record<string, unknown> };

/** In-memory store with the SAME semantics as PgJudgeStore, including the SQL
    filters of pending(): finals, attempts and in-progress claims. */
function memStore(studies: JudgeStudyRow[], decisions: JudgeDecisionRow[], clock: () => number, over: Partial<JudgeStore> = {}) {
  const events: Ev[] = [];
  const probes = new Set<string>();
  const looks: { study: string; result: JudgeLookResult }[] = [];
  const claims = (study: string, key: string) => events.filter((e) => e.study === study && e.key === key && e.kind === "claim");
  const store: JudgeStore = {
    studies: async () => studies,
    pending: async (studyId, since, fresh, limit) => decisions
      .filter((d) => d.createdAt >= since && d.createdAt >= fresh)
      .filter((d) => !events.some((e) => e.study === studyId && e.key === d.decisionKey && (e.kind === "decision" || e.kind === "invalid")))
      .filter((d) => claims(studyId, d.decisionKey).length < MAX_ATTEMPTS)
      .filter((d) => {
        const last = claims(studyId, d.decisionKey).at(-1);
        if (!last || last.at <= clock() - ABANDONED_CLAIM_SECONDS * 1000) return true;
        return events.some((e) => e.study === studyId && e.key === d.decisionKey && e.kind === "error" && e.at >= last.at);
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map((d) => ({ ...d, attempts: claims(studyId, d.decisionKey).length })),
    bars: async () => [],
    claim: async (study, key, attempt, at) => {
      if (events.some((e) => e.study === study && e.key === key && e.kind === "claim" && e.attempt === attempt)) return false;
      events.push({ study, key, kind: "claim", attempt, at });
      return true;
    },
    record: async (study, key, kind, attempt, at, payload) => {
      if (kind !== "error" && events.some((e) => e.study === study && e.key === key && (e.kind === "decision" || e.kind === "invalid"))) return false;
      events.push({ study, key, kind, attempt, at, payload });
      return true;
    },
    claimProbe: async (study, window) => (probes.has(`${study}:${window}`) ? false : (probes.add(`${study}:${window}`), true)),
    recordProbe: async (study, _w, at, payload) => void events.push({ study, key: "probe", kind: "probe", at, payload }),
    activate: async (study) => {
      const row = studies.find((s) => s.id === study && s.status === "waiting-for-model");
      if (!row) return false;
      row.status = "active";
      row.startedAt = Math.floor(clock() / 1000);
      return true;
    },
    scoreRows: async () => [] as JudgeScoreRow[],
    looks: async (study) => looks.filter((l) => l.study === study).map((l): StoredLook => ({ look: l.result.look, verdict: l.result.verdict, takenAt: "t" })),
    saveLook: async (study, result) => (looks.some((l) => l.study === study && l.result.look === result.look) ? false : (looks.push({ study, result }), true)),
    ...over,
  };
  return { store, events, looks };
}

const active = (cfg = NEMOTRON_JUDGE_STUDY): JudgeStudyRow => ({ id: cfg.id, status: "active", startedAt: Math.floor(T0 / 1000) - 3600, configHash: judgeConfigHash(cfg) });
const waiting = (): JudgeStudyRow => ({ id: KIMI_JUDGE_STUDY.id, status: "waiting-for-model", startedAt: null, configHash: judgeConfigHash(KIMI_JUDGE_STUDY) });
const answer = (text: string, model = NEMOTRON_JUDGE_STUDY.model): ChatResult => ({ model, text, usage: null, ms: 900, attempts: [] });
const budget = (now = T0, calls = 4) => ({ deadline: now + 40_000, hardStop: now + 55_000, calls });
const GOOD = '{"decision":"skip","confidence":80,"reason":"Selling into a strong uptrend."}';

describe("AI second opinion runner", () => {
  it("claims before asking, passes the deadline and its own memory, records the answer once", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)], () => T0);
    const chat = vi.fn(async (_req: ChatRequest) => answer(GOOD));
    const report = await runJudge({ store, chat, now: () => T0 }, budget());
    expect(report.decided).toBe(1);
    expect(chat.mock.calls[0][0]).toMatchObject({ models: [NEMOTRON_JUDGE_STUDY.model], deadline: T0 + 55_000, memory: JUDGE_MEMORY });
    expect(events.map((e) => e.kind)).toEqual(["claim", "decision"]);
    expect(String(events[1].payload?.input)).not.toMatch(/"(action|taken|reason)"/);
    await runJudge({ store, chat, now: () => T0 + 60_000 }, budget(T0 + 60_000));
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("records an empty answer as invalid and never re-asks it (review fix 4)", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)], () => T0 + 600_000);
    const chat = vi.fn(async () => { throw new FreeAiError("empty"); });
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).invalid).toBe(1);
    await runJudge({ store, chat, now: () => T0 + 600_000 }, budget(T0 + 600_000));
    expect(chat).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.kind === "invalid")?.payload).toMatchObject({ reason: "empty-answer" });
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });

  it("stops the pass on a failed save, never logs it as a provider error, and does not re-ask while in progress (review fix 5)", async () => {
    let now = T0;
    const failing = memStore([active()], [decision("d1", T0 / 1000 - 600), decision("d2", T0 / 1000 - 500)], () => now);
    const realRecord = failing.store.record;
    failing.store.record = async (...args) => { if (args[2] === "decision") throw new Error("database down"); return realRecord(...args); };
    const chat = vi.fn(async () => answer(GOOD));
    await expect(runJudge({ store: failing.store, chat, now: () => now }, budget(now))).rejects.toThrow("database down");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(failing.events.map((e) => e.kind)).toEqual(["claim"]);
    // A minute later the attempt still counts as in progress: d1 is not asked again.
    failing.store.record = realRecord;
    now = T0 + 60_000;
    await runJudge({ store: failing.store, chat, now: () => now }, budget(now));
    expect(chat.mock.calls.length).toBe(2);
    expect(failing.events.filter((e) => e.kind === "decision").map((e) => e.key)).toEqual(["d2"]);
  });

  it("stores only clean text: no NUL, no lone surrogate, cut by code points (review fix 5)", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600), decision("d2", T0 / 1000 - 500)], () => T0);
    const dirty = "Bad\u0000 idea\uD800 " + "😀".repeat(2000);
    const chat = vi.fn()
      .mockResolvedValueOnce(answer(JSON.stringify({ decision: "skip", confidence: 70, reason: dirty })))
      .mockResolvedValueOnce(answer("not json " + "😀".repeat(3000)));
    await runJudge({ store, chat, now: () => T0 }, budget());
    const reason = (events.find((e) => e.kind === "decision")?.payload?.verdict as { reason: string }).reason;
    expect(reason).not.toMatch(/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Array.from(reason).length).toBeLessThanOrEqual(1200);
    const raw = String(events.find((e) => e.kind === "invalid")?.payload?.raw);
    expect(Array.from(raw).length).toBeLessThanOrEqual(2000);
  });

  it("retries a provider failure in later passes, at most three attempts", async () => {
    let now = T0;
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)], () => now);
    const chat = vi.fn(async () => { throw new FreeAiError("busy", 502); });
    for (let i = 0; i < 5; i++) { now = T0 + i * 60_000; await runJudge({ store, chat, now: () => now }, budget(now)); }
    expect(chat).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(events.filter((e) => e.kind === "error")).toHaveLength(MAX_ATTEMPTS);
  });

  it("never lets a stuck decision hold up the queue (review fix 6)", async () => {
    const stuck = decision("stuck", T0 / 1000 - 900);
    const { store, events } = memStore([active()], [stuck, decision("next", T0 / 1000 - 600)], () => T0);
    for (let a = 1; a <= MAX_ATTEMPTS; a++) events.push({ study: NEMOTRON_JUDGE_STUDY.id, key: "stuck", kind: "claim", attempt: a, at: T0 - 3600_000 });
    const chat = vi.fn(async () => answer(GOOD));
    await runJudge({ store, chat, now: () => T0 }, budget());
    expect(events.filter((e) => e.kind === "decision").map((e) => e.key)).toEqual(["next"]);
  });

  it("gives each study its own share and a fixed order, so Kimi never starves Nemotron (review fix 6)", async () => {
    const decisions = Array.from({ length: 5 }, (_, i) => decision(`d${i}`, T0 / 1000 - 600 + i));
    // The database returns Kimi first; the code still asks Nemotron first.
    const { store } = memStore([active(KIMI_JUDGE_STUDY), active()], decisions, () => T0);
    const chat = vi.fn(async (req: ChatRequest) => answer(GOOD, req.models![0]));
    await runJudge({ store, chat, now: () => T0 }, budget(T0, 10));
    const models = chat.mock.calls.map(([req]) => req.models![0]);
    expect(models).toEqual([NEMOTRON_JUDGE_STUDY.model, NEMOTRON_JUDGE_STUDY.model, KIMI_JUDGE_STUDY.model, KIMI_JUDGE_STUDY.model]);
    expect(CALLS_PER_STUDY).toBe(2);
  });

  it("does not ask a decision whose attempt is still in progress, and counts only inserted answers (review fix 7)", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)], () => T0);
    events.push({ study: NEMOTRON_JUDGE_STUDY.id, key: "d1", kind: "claim", attempt: 1, at: T0 - 60_000 });
    const chat = vi.fn(async () => answer(GOOD));
    await runJudge({ store, chat, now: () => T0 }, budget());
    expect(chat).not.toHaveBeenCalled();
    const race = memStore([active()], [decision("d2", T0 / 1000 - 600)], () => T0, { record: async () => false });
    expect((await runJudge({ store: race.store, chat, now: () => T0 }, budget())).decided).toBe(0);
  });

  it("asks only while the answer can still be recorded inside two hours", async () => {
    const { store } = memStore([active()], [decision("edge", T0 / 1000 - 7200 + 60), decision("old", T0 / 1000 - 7300)], () => T0);
    const chat = vi.fn(async () => answer(GOOD));
    await runJudge({ store, chat, now: () => T0 }, budget());
    expect(chat).not.toHaveBeenCalled();
  });

  it("refuses a registration whose rules differ from the frozen code", async () => {
    const { store } = memStore([{ ...active(), configHash: "0".repeat(64) }], [decision("d1", T0 / 1000 - 600)], () => T0);
    const chat = vi.fn();
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).skipped).toEqual([NEMOTRON_JUDGE_STUDY.id]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("takes a due look and stores it once", async () => {
    const rows: JudgeScoreRow[] = Array.from({ length: 60 }, (_, i) => ({
      key: `k${String(i).padStart(2, "0")}`, session: `S${String(Math.floor(i / 4)).padStart(2, "0")}`, order: T0 / 1000 - 30 * 86400 + i * 3600,
      state: "resolved", decision: i % 2 ? "skip" : "take", net: i % 2 ? -100 : 100,
    }));
    const { store, looks } = memStore([active()], [], () => T0, { scoreRows: async () => rows });
    const chat = vi.fn();
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).looks).toEqual([{ study: NEMOTRON_JUDGE_STUDY.id, look: 1, verdict: "pass" }]);
    await runJudge({ store, chat, now: () => T0 + 60_000 }, budget(T0 + 60_000));
    expect(looks).toHaveLength(1);
  });

  it("probes a waiting model once per six hours and starts its study at the first answer", async () => {
    let now = T0;
    const rows = [waiting()];
    const { store } = memStore(rows, [], () => now);
    const chat = vi.fn<(req: ChatRequest) => Promise<ChatResult>>(async () => { throw new FreeAiError("all-unavailable"); });
    expect((await runJudge({ store, chat, now: () => now }, budget(now))).probes).toEqual([{ study: KIMI_JUDGE_STUDY.id, outcome: "all-unavailable" }]);
    now = T0 + 60_000;
    await runJudge({ store, chat, now: () => now }, budget(now));
    expect(chat).toHaveBeenCalledTimes(1);
    chat.mockImplementation(async () => answer("ready", KIMI_JUDGE_STUDY.model));
    now = T0 + MODEL_PROBE_INTERVAL_MS;
    const later = await runJudge({ store, chat, now: () => now }, budget(now));
    expect(later.activated).toEqual([KIMI_JUDGE_STUDY.id]);
    expect(rows[0].status).toBe("active");
  });

  it("does not ask, or claim, a study whose model is resting, and says so (health record)", async () => {
    const { store, events } = memStore([active(), active(DEEPSEEK_JUDGE_STUDY)], [decision("d1", T0 / 1000 - 600)], () => T0);
    const chat = vi.fn(async (req: ChatRequest) => answer(GOOD, req.models![0]));
    const available = (model: string) => model !== DEEPSEEK_JUDGE_STUDY.model;
    const report = await runJudge({ store, chat, now: () => T0, available }, budget());
    expect(chat.mock.calls.map(([req]) => req.models![0])).toEqual([NEMOTRON_JUDGE_STUDY.model]);
    expect(events.filter((e) => e.study === DEEPSEEK_JUDGE_STUDY.id)).toEqual([]);
    expect(report.resting).toEqual([DEEPSEEK_JUDGE_STUDY.id]);
    // Back from its rest, the same decision is still asked inside its window.
    const back = await runJudge({ store, chat, now: () => T0 + 60_000, available: () => true }, budget(T0 + 60_000));
    expect(back.decided).toBe(1);
    expect(events.filter((e) => e.study === DEEPSEEK_JUDGE_STUDY.id).map((e) => e.kind)).toEqual(["claim", "decision"]);
  });

  it("stops asking a study in the same pass once its first call rests the model", async () => {
    const { store, events } = memStore([active(DEEPSEEK_JUDGE_STUDY)], [decision("d1", T0 / 1000 - 900), decision("d2", T0 / 1000 - 600)], () => T0);
    let resting = false;
    const chat = vi.fn(async () => { resting = true; throw new FreeAiError("busy", 502); });
    await runJudge({ store, chat, now: () => T0, available: () => !resting }, budget());
    expect(chat).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === "claim").map((e) => e.key)).toEqual(["d1"]);
  });

  it("probes as a fresh check: asks even a resting model, with room to think, for 20 s at most", async () => {
    const rows: JudgeStudyRow[] = [{ id: DEEPSEEK_JUDGE_STUDY.id, status: "waiting-for-model", startedAt: null, configHash: judgeConfigHash(DEEPSEEK_JUDGE_STUDY) }];
    const { store, events } = memStore(rows, [], () => T0);
    const chat = vi.fn(async (_req: ChatRequest): Promise<ChatResult> => { throw new FreeAiError("timeout"); });
    const report = await runJudge({ store, chat, now: () => T0, available: () => false }, budget());
    const req = chat.mock.calls[0][0];
    expect(req).toMatchObject({ models: [DEEPSEEK_JUDGE_STUDY.model], healthCheck: true, maxTokens: 512 });
    expect(req.timeoutMs).toBeLessThanOrEqual(PROBE_TIMEOUT_MS);
    expect(PROBE_TIMEOUT_MS).toBe(20_000);
    expect(report.probes).toEqual([{ study: DEEPSEEK_JUDGE_STUDY.id, outcome: "timeout" }]);
    expect(report.activated).toEqual([]);
    expect(events.find((e) => e.kind === "probe")?.payload).toMatchObject({ outcome: "timeout", activated: false });
    expect(rows[0].status).toBe("waiting-for-model");
  });
});
