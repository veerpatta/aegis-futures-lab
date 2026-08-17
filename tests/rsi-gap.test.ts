import { describe, expect, it } from "vitest";
import { rsiReversion } from "@/lib/strategies/rsi-reversion";
import { defaultParams } from "@/lib/strategies/types";

/* The contiguity guard.

   lib/data/yahoo.ts drops any bar with a non-finite OHLC and leaves NO gap
   marker, so the array the strategy walks is compacted. rsi-reversion reads
   rsi[index-1] and rsi[index] with no check that they are 300 seconds apart,
   which means a "cross back up through 25" can be assembled from two bars
   either side of a weekend, a holiday, the daily maintenance halt or a feed
   outage. The engine's FILL is session-guarded; the SIGNAL was not.

   Default must stay off: this changes which signals exist, and every
   published tier-B figure was measured without it. */

describe("requireContiguous", () => {
  it("defaults to off, so legacy behaviour is unchanged", () => {
    expect(defaultParams(rsiReversion).requireContiguous).toBe(false);
  });

  it("is declared as a boolean parameter with the help text explaining why", () => {
    const p = rsiReversion.params.find((x) => x.key === "requireContiguous");
    expect(p).toBeTruthy();
    expect(p!.type).toBe("boolean");
    expect(p!.default).toBe(false);
    expect(String(p!.help)).toMatch(/compacted/i);
  });
});
