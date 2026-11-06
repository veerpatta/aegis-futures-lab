import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGE_PREREG_DOC, JUDGE_STUDIES, judgeConfigHash, KIMI_JUDGE_STUDY, NEMOTRON_JUDGE_STUDY } from "@/lib/ai-judge/studies";

/* The AI second opinion's rules are frozen (docs/research/2026-11-07-ai-second-opinion-preregistration.md).
   Changing any of them needs a NEW study id and preregistration, never an edit of these pins. */
const PINNED = {
  "ai-judge-nemotron-ultra-v1": "8c971da6e9cbd149cd9f953f92f3fe1f0eb6b148a018378f938b56b5fb124a68",
  "ai-judge-kimi-k3.1-pro-v1": "ca0815c88b04c76fbc98f6d7ea3917a3e80e9713838efd88c759d46faaedffd3",
};

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("AI second opinion: frozen study rules", () => {
  it("pins each study's configuration hash", () => {
    for (const s of JUDGE_STUDIES) expect(judgeConfigHash(s)).toBe(PINNED[s.id as keyof typeof PINNED]);
  });

  it("uses one model per study: Nemotron 3 Ultra now, Kimi K3.1 Pro waiting for NVIDIA", () => {
    expect(NEMOTRON_JUDGE_STUDY).toMatchObject({ model: "nvidia/nemotron-3-ultra-550b-a55b", initialStatus: "active" });
    expect(KIMI_JUDGE_STUDY).toMatchObject({ model: "moonshotai/kimi-k3.1-pro", initialStatus: "waiting-for-model" });
    expect(NEMOTRON_JUDGE_STUDY.rules).toEqual(KIMI_JUDGE_STUDY.rules);
    expect(NEMOTRON_JUDGE_STUDY.rules.looks).toEqual([
      { resolved: 60, sessions: 15, alpha: 0.01, percentile: 99 },
      { resolved: 150, sessions: 15, alpha: 0.05, percentile: 95 },
    ]);
    expect(NEMOTRON_JUDGE_STUDY.rules.freshnessSeconds).toBe(7200);
  });

  it("registers exactly these hashes in the migration and states them in the preregistration", () => {
    const migration = read("db/migrations/20261107_ai_helper.sql");
    const doc = read(JUDGE_PREREG_DOC);
    for (const [id, hash] of Object.entries(PINNED)) {
      expect(migration).toContain(`'${id}'`);
      expect(migration).toContain(`'${hash}'`);
      expect(doc).toContain(id);
      expect(doc).toContain(hash);
    }
    for (const text of ["60", "150", "99%", "95%", "10%", "90%", "two hours", "write-once", "Nothing changes automatically"]) expect(doc).toContain(text);
  });

  it("keeps the rules free of semicolons so the migration survives statement splitting", () => {
    for (const s of JUDGE_STUDIES) expect(JSON.stringify(s)).not.toContain(";");
  });
});
