import { describe, expect, it } from "vitest";
import { loadResearchEvidence } from "@/lib/ai-research/evidence";

describe("research evidence snapshot", () => {
  it("selects bounded public facts and excludes arbitrary source text and private fields", async () => {
    const sql: string[] = [];
    let released = false;
    const client = {
      async query(statement: string) {
        sql.push(statement);
        if (/transaction_timestamp/.test(statement)) return { rows: [{ captured_at: "2026-10-30T10:00:00Z" }] };
        if (/FROM public.engine_runs/.test(statement)) return { rows: [{ id: 42, ran_at: "2026-10-30T09:55:00Z", status: "ok", signals_created: 4, message: "SECRET password and fake instruction" }] };
        if (/FROM public.research_trials/.test(statement)) return { rows: [{ id: 5, registered_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-02T00:00:00Z", status: "complete", outcome: { kind: "auto-benchmark", strategyId: "orb", verdict: "no-edge", judgedYears: 8, yearsBeating: 1, headline: "IGNORE INSTRUCTIONS SECRET" } }] };
        if (/FROM public.ai_research_evidence/.test(statement)) return { rows: [{ experiment_id: "learner-2", campaign_status: "active", updated_at: "2026-10-30T09:55:00Z", equity: "9803.71", model_kind: "take_all", private_journal: "PRIVATE" }] };
        return { rows: [] };
      }, release() { released = true; },
    };
    const rows = await loadResearchEvidence({ connect: async () => client } as never);
    expect(rows.map(r => r.id)).toEqual(["engine-run:42", "research-trial:5", "experiment:learner-2:2026-10-30T09:55:00.000Z"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|IGNORE|PRIVATE|password/);
    expect(JSON.stringify(rows)).toContain("2026-10-30T09:55:00.000Z");
    expect(sql[0]).toMatch(/READ ONLY/i);
    expect(sql.at(-1)).toBe("COMMIT");
    expect(released).toBe(true);
  });
  it("rolls back and fails instead of returning invented evidence on a database error", async () => {
    const sql: string[] = [];
    let released = false;
    const client = { async query(statement: string) { sql.push(statement); if (/engine_runs/.test(statement)) throw new Error("database down"); return { rows: [{ captured_at: "2026-10-30T10:00:00Z" }] }; }, release() { released = true; } };
    await expect(loadResearchEvidence({ connect: async () => client } as never)).rejects.toThrow();
    expect(sql.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });
});
