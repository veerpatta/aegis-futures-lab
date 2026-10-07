import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXP_RISK } from "@/lib/experiment/policy";
import { PREREG } from "@/lib/experiment/prereg";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const usd = (v: number) => `$${v.toLocaleString("en-US")}`;

describe("the manual describes the learner the code runs", () => {
  const manual = read("docs/USER-MANUAL.md");
  const guide = read("app/guide/page.tsx");

  it("states the learner's limits and adoption floors from the code", () => {
    const section = manual.slice(manual.indexOf("## 4. The experimental learner"), manual.indexOf("## 5."));
    for (const v of [EXP_RISK.capital, EXP_RISK.riskPerTrade, EXP_RISK.totalOpenRisk, EXP_RISK.dailyLoss, EXP_RISK.maxDrawdown]) expect(section).toContain(usd(v));
    expect(section).toContain(`up to ${PREREG.search.maxPerWeek} new model versions`);
    expect(section).toContain(`${PREREG.gates.minOos} results it never trained on`);
    expect(section).toContain(`${PREREG.gates.freshSessions} fresh trading days`);
    expect(section).toContain(`${PREREG.gates.freshDecisions} fresh ideas`);
    expect(section).toContain(`at least ${PREREG.gates.reviewGapDays} days apart`);
  });

  it("lists the same five tabs as the guide and the nav, and both carry the same version line", () => {
    for (const tab of ["Today", "Trades", "Learn", "Chart", "More"]) {
      expect(manual).toContain(`| **${tab}** |`);
      expect(guide).toContain(`<dt>${tab}</dt>`);
    }
    expect(manual).toContain("matches the app as of 2026-10-07 (virtual trading and learning)");
    expect(guide).toContain("Matches the app as of 2026-10-07 (virtual trading and learning)");
  });

  it("keeps the no-real-money warning prominent", () => {
    expect(manual).toContain("**Nothing here touches real money.**");
    expect(guide).toContain("<b>Nothing here touches real money.</b>");
  });
});
