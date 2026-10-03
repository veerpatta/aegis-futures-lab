import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY, GLOSSARY_KEYS } from "@/lib/glossary";
import { badgeForRow, dollarsPerContract, ideaPlain, outcomeWords, standingBadge, strategyIdForRow, wrongIf } from "@/lib/plain/idea";
import { botSentence, healthLook } from "@/lib/plain/bot";
import { methodVerdict, forwardProgress } from "@/lib/plain/methods";
import { PLAIN_SUMMARY } from "@/lib/plain/strategies";
import { STRATEGIES } from "@/lib/strategies/registry";
import type { Candidate } from "@/lib/paper/overview";

const mnqBuy = {
  dedupe_key: "B:rsi-reversion:MNQ:1787033700",
  symbol: "MNQ",
  direction: "long" as const,
  entry_price: 30871,
  stop_price: 30810.01,
  target_price: 30962.49,
};

describe("trade ideas in plain words", () => {
  it("prices the stop and target per contract", () => {
    expect(dollarsPerContract("MNQ", 10)).toBe(20);
    expect(dollarsPerContract("MES", -4)).toBe(20);
    expect(dollarsPerContract("XYZ", 1)).toBeNull();
    const plain = ideaPlain(mnqBuy);
    expect(plain.side).toBe("Buy");
    expect(plain.exits).toBe("Exits at 30,810.01 if wrong (−$122 per contract) or 30,962.49 if right (+$183).");
  });

  it("handles an idea with no price target", () => {
    expect(ideaPlain({ ...mnqBuy, target_price: null }).exits).toMatch(/or on its own exit signal\.$/);
  });

  it("says when an idea is proved wrong, both ways", () => {
    expect(wrongIf(mnqBuy)).toBe("Proved wrong if price falls below 30,810.01 — 61.0 points ($122 a contract) away.");
    expect(wrongIf({ ...mnqBuy, direction: "short", stop_price: 30900 })).toMatch(/^Proved wrong if price rises above 30,900.00/);
  });

  it("reads the strategy from the dedupe key and badges its standing honestly", () => {
    expect(strategyIdForRow(mnqBuy)).toBe("rsi-reversion");
    expect(badgeForRow(mnqBuy)).toEqual({ label: "Method hasn't beaten chance", tone: "red", term: "refuted" });
    expect(badgeForRow({ dedupe_key: "A:zone-v5:MES:1" }).tone).toBe("red");
    // Unmeasured is amber, never red: nobody has looked yet.
    expect(standingBadge("unmeasured").tone).toBe("amber");
  });

  it("never calls an unresolved row open", () => {
    expect(outcomeWords("triggered", true)).toBe("Not resolved yet");
    expect(outcomeWords("triggered", false)).toBe("Open now");
  });
});

describe("the bot in plain words", () => {
  it("explains researching without implying it is trading", () => {
    const sentence = botSentence("Researching", null);
    expect(sentence).toMatch(/isn't trading its practice money/);
    expect(sentence).toMatch(/has not placed a practice trade/);
  });

  it("reads limits from the policy, not typed numbers", () => {
    expect(botSentence("Paper probation", null)).toMatch(/\$25 a trade/);
  });

  const base = { loading: false, loadFailed: false, stale: false, asleep: false, delayed: false, failing: [], lastRun: { status: "ok" } };
  it("puts health in one word, red only for a failed check", () => {
    expect(healthLook(base).label).toBe("Running");
    expect(healthLook({ ...base, asleep: true }).tone).toBe("dim");
    expect(healthLook({ ...base, failing: ["paper-broker"] }).tone).toBe("warn");
    expect(healthLook({ ...base, stale: true }).tone).toBe("warn");
    expect(healthLook({ ...base, lastRun: { status: "error" } }).tone).toBe("bad");
  });
});

describe("method verdicts follow the honesty rules", () => {
  const c = (historical: Candidate["historical"], extra: Partial<Candidate> = {}): Candidate => ({
    candidate_key: "2026-09-25.2:vwap-pullback-v1:MES",
    historical,
    confirmation: null,
    forward_closed: 0,
    forward_days: 0,
    forward_net: 0,
    weekly_passes: 0,
    ...extra,
  });
  it("too little evidence is amber, never red", () => {
    expect(methodVerdict(c({ n: 3, net: -500 })).tone).toBe("amber");
  });
  it("red only for a measured loss", () => {
    expect(methodVerdict(c({ n: 1211, net: -12174.32, gate: { promote: false } }))).toMatchObject({ tone: "red", label: "Lost money in testing" });
    expect(methodVerdict(c({ n: 400, net: 120, gate: { promote: false } })).tone).toBe("amber");
    expect(methodVerdict(c({ n: 400, net: 120, gate: { promote: true } })).tone).toBe("green");
    expect(methodVerdict(c(null)).tone).toBe("dim");
  });
  it("progress is the slower of trades and days", () => {
    expect(forwardProgress(c(null, { forward_closed: 30, forward_days: 5 }))).toBeCloseTo(0.25);
  });
});

describe("glossary", () => {
  it("every entry is short and plain", () => {
    for (const key of GLOSSARY_KEYS) {
      const { term, meaning } = GLOSSARY[key];
      expect(term.length, key).toBeGreaterThan(0);
      expect(meaning.length, key).toBeLessThan(260);
      expect(meaning, key).toMatch(/\.$/);
    }
  });

  it("every <Term k=…> used in the app exists", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk(join(process.cwd(), "components"));
    walk(join(process.cwd(), "app"));
    const used = new Set<string>();
    for (const f of files)
      for (const m of readFileSync(f, "utf8").matchAll(/<Term k="([A-Za-z]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(GLOSSARY_KEYS, key).toContain(key);
  });
});

describe("the manual matches the glossary", () => {
  it("every glossary meaning appears word for word in docs/USER-MANUAL.md", () => {
    const manual = readFileSync(join(process.cwd(), "docs", "USER-MANUAL.md"), "utf8");
    for (const key of GLOSSARY_KEYS) {
      expect(manual, key).toContain(`**${GLOSSARY[key].term}**`);
      expect(manual, key).toContain(GLOSSARY[key].meaning);
    }
  });
});

describe("plain strategy summaries", () => {
  it("covers every registered strategy", () => {
    for (const s of STRATEGIES) expect(PLAIN_SUMMARY[s.id], s.id).toBeTruthy();
  });
});
