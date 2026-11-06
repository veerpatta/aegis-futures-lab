import { describe, expect, it, vi } from "vitest";
import { FreeAiError, type ChatRequest, type ChatResult } from "@/lib/ai-free/nvidia";
import { MAX_ATTEMPTS, runJudge, type JudgeDecisionRow, type JudgeStore, type JudgeStudyRow } from "@/lib/ai-judge/runner";
import { judgeConfigHash, KIMI_JUDGE_STUDY, MODEL_PROBE_INTERVAL_MS, NEMOTRON_JUDGE_STUDY } from "@/lib/ai-judge/studies";

const T0 = Date.parse("2026-11-09T15:00:00Z");
const cutoff = Date.parse("2026-11-09T14:40:00Z") / 1000;

function decision(key: string, createdAt: number): JudgeDecisionRow {
  return {
    decisionKey: key, symbol: "MES", side: "SHORT", sessionKey: "2026-11-09", infoCutoff: cutoff, createdAt, attempts: 0,
    idea: { entry: 7437.75, stop: 7460.4, target: 7403.78, rr: 1.5, strategy: "rsi-reversion", sourcePaused: true, decisionEvidence: { contractRisk: 111.89 } },
    features: { regime: "range-high-vol", vix_bucket: "high", atr_pct: 0.18, vwap_atr: 4.6 },
  };
}

/** In-memory store with the same write-once semantics as PgJudgeStore. */
function memStore(studies: JudgeStudyRow[], decisions: JudgeDecisionRow[]) {
  const events: { study: string; key: string; kind: string; attempt?: number; payload?: Record<string, unknown> }[] = [];
  const probes = new Set<string>();
  const store: JudgeStore = {
    studies: async () => studies,
    pending: async (studyId, since, fresh) => decisions
      .filter((d) => d.createdAt >= since && d.createdAt >= fresh && !events.some((e) => e.study === studyId && e.key === d.decisionKey && (e.kind === "decision" || e.kind === "invalid")))
      .map((d) => ({ ...d, attempts: events.filter((e) => e.study === studyId && e.key === d.decisionKey && e.kind === "claim").length })),
    bars: async () => [],
    claim: async (study, key, attempt) => {
      if (events.some((e) => e.study === study && e.key === key && e.kind === "claim" && e.attempt === attempt)) return false;
      events.push({ study, key, kind: "claim", attempt });
      return true;
    },
    record: async (study, key, kind, attempt, _at, payload) => {
      if (kind !== "error" && events.some((e) => e.study === study && e.key === key && (e.kind === "decision" || e.kind === "invalid"))) return false;
      events.push({ study, key, kind, attempt, payload });
      return true;
    },
    claimProbe: async (study, window) => (probes.has(`${study}:${window}`) ? false : (probes.add(`${study}:${window}`), true)),
    recordProbe: async (study, _w, _a, payload) => void events.push({ study, key: "probe", kind: "probe", payload }),
    activate: async (study) => {
      const row = studies.find((s) => s.id === study && s.status === "waiting-for-model");
      if (!row) return false;
      row.status = "active";
      row.startedAt = Math.floor(T0 / 1000);
      return true;
    },
  };
  return { store, events };
}

const active = (): JudgeStudyRow => ({ id: NEMOTRON_JUDGE_STUDY.id, status: "active", startedAt: Math.floor(T0 / 1000) - 3600, configHash: judgeConfigHash(NEMOTRON_JUDGE_STUDY) });
const waiting = (): JudgeStudyRow => ({ id: KIMI_JUDGE_STUDY.id, status: "waiting-for-model", startedAt: null, configHash: judgeConfigHash(KIMI_JUDGE_STUDY) });
const answer = (text: string, model = NEMOTRON_JUDGE_STUDY.model): ChatResult => ({ model, text, usage: null, ms: 900, attempts: [] });
const budget = (calls = 4, now = T0) => ({ deadline: now + 40_000, calls });

describe("AI second opinion runner", () => {
  it("claims before asking, asks only the study's model, and records the answer once", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)]);
    const chat = vi.fn(async (_req: ChatRequest) => answer('{"decision":"skip","confidence":80,"reason":"Selling into a strong uptrend."}'));
    const report = await runJudge({ store, chat, now: () => T0 }, budget());
    expect(report.decided).toBe(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].models).toEqual([NEMOTRON_JUDGE_STUDY.model]);
    expect(events.map((e) => e.kind)).toEqual(["claim", "decision"]);
    expect(events[1].payload).toMatchObject({ verdict: { decision: "skip", confidence: 80 }, promptVersion: "ai-judge-prompt-v1" });
    // The model never sees what the bot did.
    expect(String(events[1].payload?.input)).not.toMatch(/"(action|taken|reason)"/);
    // A second pass asks nothing: the answer is final.
    await runJudge({ store, chat, now: () => T0 + 60_000 }, budget(4, T0 + 60_000));
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("records an unusable answer as invalid and never re-asks", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)]);
    const chat = vi.fn(async () => answer("I think it is fine."));
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).invalid).toBe(1);
    await runJudge({ store, chat, now: () => T0 + 60_000 }, budget(4, T0 + 60_000));
    expect(chat).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === "invalid")).toHaveLength(1);
  });

  it("retries a provider failure in later passes, at most three attempts", async () => {
    const { store, events } = memStore([active()], [decision("d1", T0 / 1000 - 600)]);
    const chat = vi.fn(async () => { throw new FreeAiError("busy", 502); });
    for (let i = 0; i < 5; i++) await runJudge({ store, chat, now: () => T0 + i * 60_000 }, budget(4, T0 + i * 60_000));
    expect(chat).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(events.filter((e) => e.kind === "error")).toHaveLength(MAX_ATTEMPTS);
    expect(events.find((e) => e.kind === "error")?.payload).toEqual({ code: "busy", status: 502, model: NEMOTRON_JUDGE_STUDY.model });
  });

  it("never asks about a decision recorded more than two hours ago or before the study started", async () => {
    const { store } = memStore([active()], [decision("old", T0 / 1000 - 7201), decision("before-start", T0 / 1000 - 3601)]);
    const chat = vi.fn(async () => answer('{"decision":"take","confidence":50,"reason":"x"}'));
    await runJudge({ store, chat, now: () => T0 }, budget());
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops at the call budget", async () => {
    const { store } = memStore([active()], [decision("d1", T0 / 1000 - 600), decision("d2", T0 / 1000 - 500)]);
    const chat = vi.fn(async () => answer('{"decision":"take","confidence":50,"reason":"x"}'));
    await runJudge({ store, chat, now: () => T0 }, budget(1));
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("refuses a registration whose rules differ from the frozen code", async () => {
    const { store } = memStore([{ ...active(), configHash: "0".repeat(64) }], [decision("d1", T0 / 1000 - 600)]);
    const chat = vi.fn();
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).skipped).toEqual([NEMOTRON_JUDGE_STUDY.id]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("probes a waiting model once per six hours and starts its study at the first answer", async () => {
    const rows = [waiting()];
    const { store } = memStore(rows, []);
    const chat = vi.fn<(req: ChatRequest) => Promise<ChatResult>>(async () => { throw new FreeAiError("all-unavailable"); });
    expect((await runJudge({ store, chat, now: () => T0 }, budget())).probes).toEqual([{ study: KIMI_JUDGE_STUDY.id, outcome: "all-unavailable" }]);
    await runJudge({ store, chat, now: () => T0 + 60_000 }, budget(4, T0 + 60_000));
    expect(chat).toHaveBeenCalledTimes(1);
    chat.mockImplementation(async () => answer("ready", KIMI_JUDGE_STUDY.model));
    const later = await runJudge({ store, chat, now: () => T0 + MODEL_PROBE_INTERVAL_MS }, budget(4, T0 + MODEL_PROBE_INTERVAL_MS));
    expect(chat.mock.calls[1][0].models).toEqual([KIMI_JUDGE_STUDY.model]);
    expect(later.activated).toEqual([KIMI_JUDGE_STUDY.id]);
    expect(rows[0].status).toBe("active");
  });
  it("ends every call before the pass's hard stop and starts none too close to it", async () => {
    const { store } = memStore([active()], [decision("d1", T0 / 1000 - 600), decision("d2", T0 / 1000 - 500)]);
    const chat = vi.fn(async (_req: ChatRequest) => answer('{"decision":"take","confidence":50,"reason":"x"}'));
    await runJudge({ store, chat, now: () => T0 }, { deadline: T0 + 40_000, hardStop: T0 + 20_000, calls: 4 });
    expect(chat.mock.calls.every(([req]) => (req.timeoutMs ?? 0) <= 20_000)).toBe(true);
    const late = memStore([active()], [decision("d3", T0 / 1000 - 600)]);
    const chat2 = vi.fn();
    await runJudge({ store: late.store, chat: chat2, now: () => T0 }, { deadline: T0 + 40_000, hardStop: T0 + 5_000, calls: 4 });
    expect(chat2).not.toHaveBeenCalled();
  });
});
