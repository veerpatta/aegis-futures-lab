import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_ADDENDUM_DOC, DEEPSEEK_JUDGE_STUDY, JUDGE_PREREG_DOC, JUDGE_STUDIES, judgeConfigHash, KIMI_JUDGE_STUDY, NEMOTRON_JUDGE_STUDY,
} from "@/lib/ai-judge/studies";

/* The AI second opinion's rules are frozen (docs/research/2026-11-07-ai-second-opinion-preregistration.md).
   Changing any of them needs a NEW study id and preregistration, never an edit of these pins.
   (Re-pinned once, before the migration was ever applied, for the review fixes of 2026-11-07:
   void exclusion wording, frozen stored looks, the two-hour recording window.) */
const PINNED = {
  "ai-judge-nemotron-ultra-v1": "c16a838b9e272f406b09a56c2743c77b49f6df7c5795b3a8eda42156c6134b57",
  "ai-judge-kimi-k3.1-pro-v1": "cf401d074f77dbf5905733f7845836f503d73a5985506cdcff326bf4d6b6afa3",
  // Added 2026-11-07 by the DeepSeek addendum, before any of its evidence existed.
  "ai-judge-deepseek-v4.1-flash-v1": "0f6364f6512b1d128d86b9d2c65f9fedd53a0e881dc838ec8d11e5144ac117e8",
};
const DOC_SHA256 = "902adab178113ccb12fc540423d31578d82c2df0ff81c3dff4e4e5c73b61709f";
const ADDENDUM_SHA256 = "6bae41c6aa245964cec1253acebb611ec69f7362b5175b19c4c5443850899aca";
/** Where each study was registered, and its human copy. */
const REGISTERED: Record<keyof typeof PINNED, { migration: string; doc: string }> = {
  "ai-judge-nemotron-ultra-v1": { migration: "db/migrations/20261107_ai_helper.sql", doc: JUDGE_PREREG_DOC },
  "ai-judge-kimi-k3.1-pro-v1": { migration: "db/migrations/20261107_ai_helper.sql", doc: JUDGE_PREREG_DOC },
  "ai-judge-deepseek-v4.1-flash-v1": { migration: "db/migrations/20261107_ai_deepseek.sql", doc: DEEPSEEK_ADDENDUM_DOC },
};
const sha = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("AI second opinion: frozen study rules", () => {
  it("pins each study's configuration hash", () => {
    expect(JUDGE_STUDIES.map((s) => s.id)).toEqual(Object.keys(PINNED));
    for (const s of JUDGE_STUDIES) expect(judgeConfigHash(s)).toBe(PINNED[s.id as keyof typeof PINNED]);
  });

  it("pins the preregistration document and the DeepSeek addendum (line endings normalised)", () => {
    expect(sha(read(JUDGE_PREREG_DOC))).toBe(DOC_SHA256);
    expect(sha(read(DEEPSEEK_ADDENDUM_DOC))).toBe(ADDENDUM_SHA256);
  });

  it("uses one model per study: Nemotron 3 Ultra now, Kimi K3.1 Pro and DeepSeek V4.1 Flash waiting for NVIDIA", () => {
    expect(NEMOTRON_JUDGE_STUDY).toMatchObject({ model: "nvidia/nemotron-3-ultra-550b-a55b", initialStatus: "active" });
    expect(KIMI_JUDGE_STUDY).toMatchObject({ model: "moonshotai/kimi-k3.1-pro", initialStatus: "waiting-for-model" });
    expect(DEEPSEEK_JUDGE_STUDY).toMatchObject({ model: "deepseek-ai/deepseek-v4.1-flash", initialStatus: "waiting-for-model", label: "DeepSeek V4.1 Flash" });
    expect(NEMOTRON_JUDGE_STUDY.rules).toEqual(KIMI_JUDGE_STUDY.rules);
    // The very same frozen object, prompt and features: no rule moved for the newcomer.
    expect(DEEPSEEK_JUDGE_STUDY.rules).toBe(NEMOTRON_JUDGE_STUDY.rules);
    expect([DEEPSEEK_JUDGE_STUDY.promptVersion, DEEPSEEK_JUDGE_STUDY.featureVersion]).toEqual([NEMOTRON_JUDGE_STUDY.promptVersion, NEMOTRON_JUDGE_STUDY.featureVersion]);
    expect(NEMOTRON_JUDGE_STUDY.rules.looks).toEqual([
      { resolved: 60, sessions: 15, alpha: 0.01, percentile: 99 },
      { resolved: 150, sessions: 15, alpha: 0.05, percentile: 95 },
    ]);
    expect(NEMOTRON_JUDGE_STUDY.rules.freshnessSeconds).toBe(7200);
  });

  it("registers exactly these hashes in their migrations and states them in their documents", () => {
    for (const [id, hash] of Object.entries(PINNED)) {
      const { migration, doc } = REGISTERED[id as keyof typeof PINNED];
      expect(read(migration)).toContain(`'${id}'`);
      expect(read(migration)).toContain(`'${hash}'`);
      expect(read(doc)).toContain(id);
      expect(read(doc)).toContain(hash);
    }
    const doc = read(JUDGE_PREREG_DOC);
    for (const text of ["60", "150", "99%", "95%", "10%", "90%", "two hours", "write-once", "Nothing changes automatically", "stored once"]) expect(doc).toContain(text);
  });

  it("adds DeepSeek without touching the earlier registration, waiting, with the code's exact config", () => {
    expect(read("db/migrations/20261107_ai_helper.sql")).not.toMatch(/deepseek/i);
    const sql = read("db/migrations/20261107_ai_deepseek.sql");
    const config = /'(\{"id":"ai-judge-deepseek-v4\.1-flash-v1".*?\})'::jsonb/s.exec(sql)?.[1];
    expect(config).toBeTruthy();
    expect(JSON.parse(config!.replace(/''/g, "'"))).toEqual(DEEPSEEK_JUDGE_STUDY);
    expect(sql).toMatch(/'waiting-for-model', now\(\), NULL\)\s*ON CONFLICT \(id\) DO NOTHING/);
    // The health table is private: RLS on, nothing for the browser roles.
    expect(sql).toContain("ALTER TABLE public.ai_model_health ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.ai_model_health FROM PUBLIC, anonymous, authenticated");
    expect(sql).not.toMatch(/GRANT[^;]*ai_model_health[^;]*TO (anonymous|authenticated)/);
    // No semicolon outside statement ends, so any statement splitter keeps it whole.
    expect(sql.split("\n").filter((l) => l.startsWith("--")).join("\n")).not.toContain(";");
    const addendum = read(DEEPSEEK_ADDENDUM_DOC);
    for (const text of ["502", "first successful answer", "six hours", "Nothing changes automatically", "no rule changes", "nothing is claimed"]) expect(addendum).toContain(text);
  });

  it("says what the code does about cancelled simulations: excluded as void, never counted as 0 (review fix 2)", () => {
    const doc = read(JUDGE_PREREG_DOC);
    expect(doc).not.toMatch(/cancelled simulation counts as 0/i);
    expect(doc).toMatch(/\*\*void\*\* outcomes \(no fill\s+was possible; the learner stores a cancelled shadow simulation as void\)/);
    expect(NEMOTRON_JUDGE_STUDY.rules.outcome).toMatch(/void outcomes \(no fill was possible, including cancelled simulations\)/);
  });

  it("keeps the rules free of semicolons so the migration survives statement splitting", () => {
    for (const s of JUDGE_STUDIES) expect(JSON.stringify(s)).not.toContain(";");
  });
});
