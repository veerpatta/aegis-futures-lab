import { describe, expect, it } from "vitest";
import { outcomeState, PgJudgeStore, readScoreboard, type Db } from "@/lib/ai-judge/store-pg";
import { ABANDONED_CLAIM_SECONDS, MAX_ATTEMPTS } from "@/lib/ai-judge/runner";
import { judgeConfigHash, NEMOTRON_JUDGE_STUDY } from "@/lib/ai-judge/studies";

function fakeDb(route: (sql: string, values: unknown[]) => Record<string, unknown>[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db: Db = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: route(sql, values) }; } };
  return { db, calls };
}

describe("second opinion storage", () => {
  it("filters stuck and in-progress decisions in SQL, oldest first (review fixes 6 and 7)", async () => {
    const now = Date.parse("2026-11-09T15:00:00Z");
    const { db, calls } = fakeDb(() => []);
    await new PgJudgeStore(db, () => now).pending("study", 1, 2, 4);
    const { sql, values } = calls[0];
    expect(sql).toMatch(/coalesce\(c\.attempts, 0\) < \$5/);
    expect(sql).toMatch(/c\.last_claim > to_timestamp\(\$6\)/);
    expect(sql).toMatch(/kind = 'error' AND x\.occurred_at >= c\.last_claim/);
    expect(sql).toMatch(/ORDER BY d\.created_at, d\.decision_key\s+LIMIT \$4/);
    expect(values).toEqual(["study", 1, 2, 4, MAX_ATTEMPTS, Math.floor(now / 1000) - ABANDONED_CLAIM_SECONDS]);
  });

  it("orders studies by id, never by an equal registration time (review fix 6)", async () => {
    const { db, calls } = fakeDb(() => []);
    await new PgJudgeStore(db).studies();
    expect(calls[0].sql).toMatch(/ORDER BY id$/);
  });

  it("maps outcomes the way the learner's own dataset does (review fix 2)", () => {
    expect(outcomeState({ outcome_status: "void", net: null, standalone_qty: 1 })).toEqual({ state: "excluded", net: null });
    expect(outcomeState({ outcome_status: "closed", net: "-111.89", standalone_qty: 1 })).toEqual({ state: "resolved", net: -111.89 });
    expect(outcomeState({ outcome_status: "closed", net: null, standalone_qty: 1 })).toEqual({ state: "excluded", net: null });
    expect(outcomeState({ outcome_status: "closed", net: "50", standalone_qty: 0 })).toEqual({ state: "excluded", net: null });
    expect(outcomeState({ outcome_status: "pending", net: null, standalone_qty: 1 })).toEqual({ state: "open", net: null });
    expect(outcomeState({})).toEqual({ state: "open", net: null });
  });

  it("shows the STORED look's verdict, not one recomputed from today's numbers (review fix 1)", async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes("FROM public.ai_judge_studies")) return [{ id: NEMOTRON_JUDGE_STUDY.id, status: "active", started_at: "2026-11-07T00:00:00Z", config_hash: judgeConfigHash(NEMOTRON_JUDGE_STUDY) }];
      if (sql.includes("FROM public.ai_looks")) return [{ look: 1, verdict: "inconclusive", taken_at: "2026-12-01T00:00:00Z" }];
      if (sql.includes("FROM public.ai_judge_calls c")) return [{ decision_key: "k1", decision: "take", session_key: "S1", created: 1_800_000_000, outcome_status: "closed", net: "500", standalone_qty: 1 }];
      return [];
    });
    const [s] = await readScoreboard(db, Date.parse("2026-12-02T00:00:00Z"));
    expect(s).toMatchObject({ verdict: "inconclusive", nextLook: 150, calls: 1, resolved: 1, aiNet: 500 });
    expect(s.waiting).toMatch(/^Look 2: /);
  });
});
