import { describe, expect, it } from "vitest";
import { decisionFields, describeWhen, matches, parseRule, ruleHash, type Rule } from "@/lib/ai-ideas/dsl";
import { factsTable, type FinishedDecision } from "@/lib/ai-ideas/facts";

const rule = (when: unknown[], extra: Record<string, unknown> = {}) => ({ name: "Skip stretched shorts", why: "Shorts far above the average lost money.", when, then: "skip", ...extra });

describe("AI ideas: the rule language", () => {
  it("accepts a valid rule and normalises case and numeric strings", () => {
    const r = parseRule(rule([{ field: "side", op: "=", value: "short" }, { field: "vwap_atr", op: ">", value: "2.5" }, { field: "weekday", op: "!=", value: "mon" }]));
    expect(r).toEqual({ ok: true, rule: { name: "Skip stretched shorts", why: "Shorts far above the average lost money.", then: "skip",
      when: [{ field: "side", op: "=", value: "SHORT" }, { field: "vwap_atr", op: ">", value: 2.5 }, { field: "weekday", op: "!=", value: "Mon" }] } });
  });

  it("refuses anything outside the whitelist", () => {
    const bad: [unknown, string][] = [
      [rule([{ field: "net", op: ">", value: 0 }]), "unknown-field"],
      [rule([{ field: "exit_price", op: "<", value: 1 }]), "unknown-field"],
      [rule([{ field: "side", op: "<", value: "SHORT" }]), "bad-value:side"],
      [rule([{ field: "side", op: "=", value: "SIDEWAYS" }]), "bad-value:side"],
      [rule([{ field: "rr", op: ">", value: 99 }]), "bad-value:rr"],
      [rule([{ field: "hour_ny", op: "=", value: 9.5 }]), "bad-value:hour_ny"],
      [rule([{ field: "paused", op: "=", value: "yes" }]), "bad-value:paused"],
      [rule([{ field: "rr", op: ">=", value: 1 }]), "bad-op"],
      [rule([]), "one-to-three-conditions"],
      [rule([1, 2, 3, 4].map((h) => ({ field: "hour_ny", op: "!=", value: h }))), "one-to-three-conditions"],
      [rule([{ field: "rr", op: ">", value: 1 }, { field: "rr", op: ">", value: 2 }]), "duplicate-condition"],
      [rule([{ field: "rr", op: ">", value: 1, extra: true }]), "bad-condition"],
      [rule([{ field: "rr", op: ">", value: 1 }], { then: "take" }), "then-must-be-skip"],
      [rule([{ field: "rr", op: ">", value: 1 }], { size: 2 }), "unknown-key"],
      [rule([{ field: "rr", op: ">", value: 1 }], { name: "x".repeat(61) }), "bad-name"],
      [rule([{ field: "rr", op: ">", value: 1 }], { why: "<script>alert(1)</script>" }), "bad-why"],
      [rule([{ field: "rr", op: ">", value: 1 }], { why: "see https://example.com" }), "bad-why"],
      ["not a rule", "not-an-object"],
    ];
    for (const [raw, error] of bad) expect(parseRule(raw)).toEqual({ ok: false, error });
  });

  it("lets a reason compare values but never carry a tag (live probe 2026-11-07)", () => {
    expect(parseRule(rule([{ field: "vwap_atr", op: ">", value: 3 }], { why: "Ideas with vwap_atr > 3 and rr < 2 did worse." })).ok).toBe(true);
    expect(parseRule(rule([{ field: "vwap_atr", op: ">", value: 3 }], { why: "<b>bold</b> claim" }))).toEqual({ ok: false, error: "bad-why" });
    expect(parseRule(rule([{ field: "vwap_atr", op: ">", value: 3 }], { name: "Skip < /script" }))).toEqual({ ok: false, error: "bad-name" });
  });

  it("identifies a rule by its logic, not its wording or condition order", () => {
    const a = parseRule(rule([{ field: "side", op: "=", value: "SHORT" }, { field: "rr", op: "<", value: 1.6 }])) as { ok: true; rule: Rule };
    const b = parseRule(rule([{ field: "rr", op: "<", value: "1.6" }, { field: "side", op: "=", value: "short" }], { name: "Another name", why: "Other words." })) as { ok: true; rule: Rule };
    expect(ruleHash(a.rule)).toBe(ruleHash(b.rule));
    expect(describeWhen(a.rule.when)).toBe("side = SHORT and rr < 1.6");
  });

  it("reads only decision-time fields, with New York hour and weekday", () => {
    const f = decisionFields({
      symbol: "MES", side: "SHORT", decidedAt: Date.parse("2026-11-06T15:10:00Z") / 1000, estRisk: "111.89",
      idea: { strategy: "rsi-reversion", tier: "B", sourcePaused: true, rr: 1.5 }, features: { regime: "range-high-vol", vix_bucket: "high", atr_pct: 0.18, vwap_atr: 4.6 },
    });
    expect(f).toEqual({ side: "SHORT", symbol: "MES", strategy: "rsi-reversion", tier: "B", paused: true, regime: "range-high-vol", vix_bucket: "high", rr: 1.5, atr_pct: 0.18, vwap_atr: 4.6, risk_usd: 111.89, hour_ny: 10, weekday: "Fri" });
  });

  it("matches only when every condition holds; a missing field means the idea is taken", () => {
    const r = (parseRule(rule([{ field: "paused", op: "=", value: true }, { field: "vwap_atr", op: ">", value: 2 }])) as { ok: true; rule: Rule }).rule;
    expect(matches(r, { paused: true, vwap_atr: 4.6 })).toBe(true);
    expect(matches(r, { paused: true, vwap_atr: 1 })).toBe(false);
    expect(matches(r, { vwap_atr: 4.6 })).toBe(false);
    const notMon = (parseRule(rule([{ field: "weekday", op: "!=", value: "Mon" }])) as { ok: true; rule: Rule }).rule;
    expect(matches(notMon, {})).toBe(false);
  });
});

describe("AI ideas: the facts table", () => {
  const row = (i: number, fields: FinishedDecision["fields"], net: number): FinishedDecision => ({ key: `k${i}`, session: `S${i % 5}`, fields, net });
  it("buckets categories by value and numbers into thirds, with counts, wins and the result per idea", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i, { side: i % 2 ? "SHORT" : "LONG", vwap_atr: i - 3, rr: 1.5 }, i % 3 === 0 ? 100 : -50));
    const t = factsTable(rows);
    expect(t.overall).toMatchObject({ finished_ideas: 12, sessions: 5, wins: 4, win_rate_pct: 33, net_per_idea_usd: 0, total_net_usd: 0 });
    expect(t.by_field.side).toEqual([
      { bucket: "side = LONG", n: 6, wins: 2, win_rate_pct: 33, net_per_idea_usd: 0, total_net_usd: 0 },
      { bucket: "side = SHORT", n: 6, wins: 2, win_rate_pct: 33, net_per_idea_usd: 0, total_net_usd: 0 },
    ]);
    expect(t.by_field.rr).toEqual([{ bucket: "rr = 1.5", n: 12, wins: 4, win_rate_pct: 33, net_per_idea_usd: 0, total_net_usd: 0 }]);
    expect(t.by_field.vwap_atr!.map((b) => b.bucket)).toEqual(["vwap_atr < 1", "1 <= vwap_atr <= 4", "vwap_atr > 4"]);
    expect(t.by_field.vwap_atr!.reduce((a, b) => a + b.n, 0)).toBe(12);
    expect(t.by_field.paused).toBeUndefined();
  });
});
