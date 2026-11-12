import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TM_FILTER_PREREG_DOC, TM_FILTER_RULES, tmFilterRulesHash } from "@/lib/tm-study/rules";
import { costR, filterCall } from "@/lib/tm-study/filter";
import { TM_DEFAULTS, TM_FIRST_MIN, TM_LOOKBACK_DAYS } from "@/lib/timemachine";
import { SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";
import { COMMISSION_RT, pointValue, slipPoints } from "@/lib/experiment/policy";
import { nyTimeToUnix } from "@/lib/time/ny";

/* The time machine filter is frozen before any result was computed
   (docs/research/2026-11-12-time-machine-filter-preregistration.md). Changing a rule means a
   new version and a new preregistration, never an edit of these pins. */
const RULES_HASH = "7be49bdb83f3497e0dc9449da7516cbd896b2cda3e72db6bf000cc41fbfbdb7e";
const DOC_SHA256 = "f1ed1f3787e3490a40a9ede4a0293cb7d09f35263b6dc7cdab94e305bdbe893b";

const doc = () => readFileSync(resolve(process.cwd(), TM_FILTER_PREREG_DOC), "utf8").replace(/\r\n/g, "\n");

describe("time machine filter: frozen rules", () => {
  it("pins the configuration hash and the preregistration document", () => {
    expect(tmFilterRulesHash()).toBe(RULES_HASH);
    expect(createHash("sha256").update(doc()).digest("hex")).toBe(DOC_SHA256);
    expect(doc()).toContain(RULES_HASH);
  });

  it("uses exactly the time machine the trade page shows", () => {
    const t = TM_FILTER_RULES.timeMachine;
    expect({ replays: t.replays, seed: t.seed, window: t.window, minSessions: t.minSessions, maxSessions: t.maxSessions }).toEqual({ ...TM_DEFAULTS });
    expect(t.firstMinuteNy).toBe(TM_FIRST_MIN);
    expect(t.flatMinuteNy).toBe(SESSION_FLAT_MINUTE);
    expect(t.lookbackDays).toBe(TM_LOOKBACK_DAYS);
  });

  it("states every threshold in the document", () => {
    const text = doc();
    for (const s of ["10% and", "60%", "≥ 95", "≥ 99", "99%", "95%", "**24 hours**", "**52 weeks**", "hist-2026-10-07", "seed 19", "59", "20"]) expect(text).toContain(s);
    expect(TM_FILTER_RULES.forward.looks).toEqual([
      { resolved: 60, sessions: 15, alpha: 0.01, percentile: 99 },
      { resolved: 150, sessions: 15, alpha: 0.05, percentile: 95 },
    ]);
    expect(TM_FILTER_RULES.historical.look).toEqual({ alpha: 0.05, percentile: 95 });
    expect(TM_FILTER_RULES.scoring.skipRate).toEqual({ min: 0.1, max: 0.6 });
  });
});

describe("time machine filter: the call", () => {
  const at = nyTimeToUnix("2026-10-21", 600);

  it("prices costs with the learner's own model", () => {
    const pv = pointValue("MES");
    expect(costR("MES", 6800, 6790, at)).toBeCloseTo((COMMISSION_RT + 2 * slipPoints("MES", at) * pv) / (10 * pv), 10);
  });

  it("takes the idea when the time machine cannot run", () => {
    const r = filterCall([], { symbol: "MES", side: "LONG", stop: 6790, target: 6820, refPrice: 6800, decidedAt: at });
    expect(r).toEqual({ ok: false, skip: false, refusal: "few-sessions" });
  });
});
