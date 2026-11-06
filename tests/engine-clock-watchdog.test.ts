import { describe, expect, it } from "vitest";
import { describeClock } from "../scripts/engine/watchdog.mjs";

const NOW = new Date("2026-11-06T15:00:00Z");
const row = (outcome: string, minutesAgo = 9, extra: Record<string, unknown> = {}) => ({
  fired_at: new Date(NOW.getTime() - minutesAgo * 60000).toISOString(), outcome, http_status: null, message: null, ...extra,
});

describe("watchdog: engine clock line", () => {
  it("says the clock is missing when it never fired", () => {
    expect(describeClock(null, NOW)).toMatch(/^Fast clock: not running yet.*docs\/ENGINE-CLOCK\.md/);
  });

  it("points at the missing key, an expired key and an unreachable GitHub", () => {
    expect(describeClock(row("not-configured"), NOW)).toContain("ENGINE_DISPATCH_TOKEN");
    expect(describeClock(row("rejected", 9, { http_status: 401 }), NOW)).toMatch(/refused its key \(HTTP 401\) 9 min ago; the key may have expired/);
    expect(describeClock(row("failed", 9, { message: "GitHub unreachable: fetch failed" }), NOW)).toContain("could not reach GitHub 9 min ago (GitHub unreachable: fetch failed)");
    expect(describeClock(row("dispatched", 9), NOW)).toContain("started the engine 9 min ago");
  });

  it("flags a clock whose own schedule went quiet", () => {
    expect(describeClock(row("dispatched", 180), NOW)).toMatch(/last fired 180 min ago; its Neon schedule may be off/);
  });
});
