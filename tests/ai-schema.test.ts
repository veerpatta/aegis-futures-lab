import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), "db/migrations/20261030_ai_research.sql");
const read = () => existsSync(path) ? readFileSync(path, "utf8") : "";

describe("AI research database isolation", () => {
  it("keeps paid-request and shadow evidence private from public browser roles", () => {
    const sql = read();
    for (const table of ["ai_budget_reservations", "ai_research_requests", "ai_research_results", "ai_shadow_studies", "ai_shadow_snapshots", "ai_shadow_events"]) {
      expect(sql, table).toContain(`'${table}'`);
    }
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON (?:TABLE )?public\.%I FROM PUBLIC, anonymous, authenticated/i);
  });

  it("protects registered studies, observed snapshots and events from privileged rewrites", () => {
    const sql = read();
    for (const table of ["ai_shadow_studies", "ai_shadow_snapshots", "ai_shadow_events"]) {
      expect(sql, table).toContain(`protect_${table}`);
    }
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE/i);
    expect(sql).toMatch(/PRIMARY KEY\s*\(study_id,\s*opportunity_key\)/i);
  });

  it("keeps the budget reservation identity immutable, and accepts one final settlement", () => {
    const sql = read();
    expect(sql).toContain("protect_ai_budget_reservations");
    expect(sql).toMatch(/OLD\.status\s*=\s*'settled'/i);
    expect(sql).toMatch(/NEW\.status\s*(?:<>|!=)\s*'settled'/i);
    expect(sql).toMatch(/OLD\.reserved_micros\s+IS DISTINCT FROM\s+NEW\.reserved_micros/i);
  });

  it("binds each private result to the account that created the request", () => {
    expect(read()).toMatch(/FOREIGN KEY\s*\(request_id,\s*user_id\)\s*REFERENCES public\.ai_research_requests\s*\(id,\s*user_id\)/i);
  });
});
