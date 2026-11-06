import { describe, expect, it, vi } from "vitest";
import { FreeAiError, type ChatRequest, type ChatResult } from "@/lib/ai-free/nvidia";
import { isoWeekKey, runIdeas, type HypothesisRow, type IdeasStore, type PopulationRow } from "@/lib/ai-ideas/runner";
import { parseRule, ruleHash, type Rule } from "@/lib/ai-ideas/dsl";
import type { FinishedDecision } from "@/lib/ai-ideas/facts";
import type { StoredLook } from "@/lib/ai-judge/looks";
import type { CoachNote } from "@/lib/ai-coach/runner";

const NOW = Date.parse("2026-11-16T15:00:00Z");
const finished = (n: number): FinishedDecision[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, session: `S${i % 6}`, net: i % 3 ? -60 : 120, fields: { side: i % 2 ? "SHORT" : "LONG", vwap_atr: i % 5 } }));
const rule = (field = "side", value: unknown = "SHORT"): Rule => (parseRule({ name: "Skip it", why: "It did worse.", when: [{ field, op: "=", value }], then: "skip" }) as { ok: true; rule: Rule }).rule;
const hyp = (id: string, r: Rule, proposedAt = NOW / 1000 - 8 * 86400): HypothesisRow => ({ id, proposedAt, model: "m", promptVersion: "v", rule: r, ruleHash: ruleHash(r), status: "testing", retiredAt: null, retireReason: null });

function store(over: Partial<IdeasStore> & { hyps?: HypothesisRow[]; pop?: PopulationRow[]; fin?: FinishedDecision[]; last?: number | null } = {}) {
  const inserted: { id: string; rule: Rule }[] = [], notes: CoachNote[] = [], retired: string[] = [], looks = new Map<string, StoredLook[]>();
  const s: IdeasStore = {
    hypotheses: async () => over.hyps ?? [],
    lastProposalAt: async () => over.last ?? null,
    finished: async () => over.fin ?? finished(30),
    population: async () => over.pop ?? [],
    looks: async (id) => [...(looks.get(id) ?? [])],
    saveLook: async (id, r) => { const l = looks.get(id) ?? []; if (l.some((x) => x.look === r.look)) return false; l.push({ look: r.look, verdict: r.verdict, takenAt: "t" }); looks.set(id, l); return true; },
    insert: async (h) => (inserted.push({ id: h.id, rule: h.rule }), true),
    retire: async (id) => (retired.push(id), true),
    saveWeekNote: async (n) => (notes.push(n), true),
    ...over,
  };
  return { s, inserted, notes, retired, looks };
}
const reply = (text: string): ChatResult => ({ model: "nvidia/nemotron-3-ultra-550b-a55b", text, usage: null, ms: 1, attempts: [] });
const budget = () => ({ deadline: NOW + 40_000, hardStop: NOW + 55_000, calls: 4 });
const PROPOSAL = JSON.stringify({
  summary: "Of the 30 finished ideas, 10 were winners. Shorts and longs did the same.",
  ideas: [{ name: "Skip stretched ideas", why: "Ideas 4 ATR from the average did worse.", when: [{ field: "vwap_atr", op: ">", value: 3 }], then: "skip" },
    { name: "Skip shorts", why: "Shorts did worse.", when: [{ field: "side", op: "=", value: "SHORT" }], then: "skip" }],
});

describe("AI ideas: one pass", () => {
  it("proposes weekly into the free slots, stores the rules and the week's summary", async () => {
    const { s, inserted, notes } = store({ hyps: [hyp("idea-aaaaaaaaaaaa", rule("paused", true)), hyp("idea-bbbbbbbbbbbb", rule("tier", "A"))] });
    const chat = vi.fn(async (_req: ChatRequest) => reply(PROPOSAL));
    const r = await runIdeas({ store: s, chat, now: () => NOW }, budget());
    expect(r).toMatchObject({ proposed: 1, rejected: 1, summary: "accepted", waiting: null });
    expect(inserted[0].id).toMatch(/^idea-[0-9a-f]{12}$/);
    expect(inserted[0].rule.when).toEqual([{ field: "vwap_atr", op: ">", value: 3 }]);
    expect(notes[0]).toMatchObject({ kind: "week", subject: isoWeekKey(NOW / 1000), status: "accepted" });
    expect(chat.mock.calls[0][0]).toMatchObject({ deadline: NOW + 55_000 });
    expect(chat.mock.calls[0][0].system).toMatch(/at most 1 simple rule/);
  });

  it("waits: not due within 7 days, no free slot, too few finished decisions, no budget", async () => {
    const chat = vi.fn();
    expect((await runIdeas({ store: store({ last: NOW / 1000 - 6 * 86400 }).s, chat, now: () => NOW }, budget())).waiting).toBe("not-due");
    const full = [rule("tier", "A"), rule("tier", "B"), rule("paused", true)].map((r, i) => hyp(`idea-${String(i).repeat(12)}`, r));
    expect((await runIdeas({ store: store({ hyps: full }).s, chat, now: () => NOW }, budget())).waiting).toBe("no-free-slot");
    expect((await runIdeas({ store: store({ fin: finished(19) }).s, chat, now: () => NOW }, budget())).waiting).toBe("too-few-finished");
    expect((await runIdeas({ store: store().s, chat, now: () => NOW }, { ...budget(), calls: 0 })).waiting).toBe("no-budget");
    expect(chat).not.toHaveBeenCalled();
  });

  it("counts a provider failure and stores nothing, so the proposal is retried next pass", async () => {
    const { s, inserted, notes } = store();
    const chat = vi.fn(async () => { throw new FreeAiError("busy", 502); });
    expect((await runIdeas({ store: s, chat, now: () => NOW }, budget())).errors).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });

  it("stops the pass when saving fails, without counting it as a provider error (review fix 5)", async () => {
    const { s } = store({ saveWeekNote: async () => { throw new Error("database down"); } });
    await expect(runIdeas({ store: s, chat: vi.fn(async () => reply(PROPOSAL)), now: () => NOW }, budget())).rejects.toThrow("database down");
  });

  it("stores a due look once and retires the rule from its stored verdict", async () => {
    const h = hyp("idea-cccccccccccc", rule("side", "SHORT"), NOW / 1000 - 30 * 86400);
    // 75 decisions over 15 days; the rule skips the SHORT ones, which all lose.
    const pop: PopulationRow[] = Array.from({ length: 75 }, (_, i) => ({
      key: `d${String(i).padStart(3, "0")}`, session: `S${String(Math.floor(i / 5)).padStart(2, "0")}`, order: NOW / 1000 - 20 * 86400 + i * 3600,
      state: "resolved", net: i % 5 === 0 ? -300 : 50, fields: { side: i % 5 === 0 ? "SHORT" : "LONG" },
    }));
    const st = store({ hyps: [h], pop, last: NOW / 1000 });
    const r = await runIdeas({ store: st.s, chat: vi.fn(), now: () => NOW }, budget());
    expect(r.looks).toEqual([{ idea: "idea-cccccccccccc", look: 1, verdict: "pass" }]);
    expect(r.retired).toEqual(["idea-cccccccccccc"]);
  });

  it("names ISO weeks from the New York date", () => {
    expect(isoWeekKey(Date.parse("2026-11-09T15:00:00Z") / 1000)).toBe("2026-W46");
    expect(isoWeekKey(Date.parse("2027-01-01T15:00:00Z") / 1000)).toBe("2026-W53");
  });
});
