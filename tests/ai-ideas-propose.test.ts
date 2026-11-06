import { describe, expect, it } from "vitest";
import { parseProposal, proposalSystem, proposalUser } from "@/lib/ai-ideas/propose";
import { factsTable, type FinishedDecision } from "@/lib/ai-ideas/facts";
import { parseRule, ruleHash, type Rule } from "@/lib/ai-ideas/dsl";

const rows: FinishedDecision[] = Array.from({ length: 24 }, (_, i) => ({
  key: `k${i}`, session: `S${i % 8}`, net: i % 3 === 0 ? 150 : -75,
  fields: { side: i % 2 ? "SHORT" : "LONG", vwap_atr: (i % 6) - 1, paused: i % 4 === 0, rr: 1.5 },
}));
const facts = factsTable(rows);
const idea = (when: unknown[], why = "Shorts did worse in the statistics.") => ({ name: "Skip shorts", why, when, then: "skip" });

describe("AI ideas: the weekly proposal", () => {
  it("tells the model the honest odds, the fields it may use and the free slots", () => {
    const sys = proposalSystem(2);
    expect(sys).toMatch(/have not beaten random entries/);
    expect(sys).toMatch(/at most 2 simple rule/);
    expect(sys).toMatch(/vwap_atr .*number -50 to 50/);
    expect(sys).toMatch(/side .*one of LONG, SHORT; ops = or !=/);
    const user = JSON.parse(proposalUser(facts, [{ name: "Old", when: [{ field: "paused", op: "=", value: true }] }], 2));
    expect(user).toMatchObject({ free_slots: 2, rules_already_testing: [{ name: "Old", when: "paused = true" }] });
  });

  it("keeps valid rules up to the free slots and refuses the rest with reasons", () => {
    const testing = (parseRule(idea([{ field: "paused", op: "=", value: true }])) as { ok: true; rule: Rule }).rule;
    const text = JSON.stringify({
      summary: "Of the 24 finished ideas, 8 were winners. Shorts and longs did about the same.",
      ideas: [
        idea([{ field: "side", op: "=", value: "SHORT" }]),
        idea([{ field: "paused", op: "=", value: true }]),
        idea([{ field: "net", op: ">", value: 0 }]),
        idea([{ field: "vwap_atr", op: ">", value: 3 }], "Ideas this stretched lost 999 dollars."),
        idea([{ field: "vwap_atr", op: ">", value: 3 }], "Ideas stretched above 3 ATR from the average did worse."),
        idea([{ field: "rr", op: "<", value: 1.4 }]),
      ],
    });
    const p = parseProposal(`Sure! ${text}`, facts, 2, new Set([ruleHash(testing)]));
    expect(p.rules.map((r) => r.when[0].field)).toEqual(["side", "vwap_atr"]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["duplicate", "unknown-field", "unsupported-number", "no-free-slot"]);
    expect(p.summary).toMatch(/^Of the 24 finished ideas/);
    expect(p.summaryReject).toBeNull();
  });

  it("stores a summary with invented numbers as rejected, and survives an unparseable answer", () => {
    const bad = parseProposal(JSON.stringify({ summary: "The bot would make 4321 dollars a week with these rules, says the data.", ideas: [] }), facts, 3, new Set());
    expect(bad.summaryReject).toBe("unsupported-number");
    const none = parseProposal("I cannot help with that.", facts, 3, new Set());
    expect(none).toEqual({ summary: null, summaryReject: "unparseable", rules: [], rejected: [] });
  });
});
