import { describe, expect, it } from "vitest";
import {
  DAILY_FUNNEL_STAT_KEY,
  summarizeDailyFunnel,
  type DailyFunnelPayload,
} from "@/lib/signals/daily-funnel";

/* Item 2.7. The panel must answer "broken or just patient?" without jargon,
   from counts the engine actually tallied — and must never present a guess as
   a count. */

const payload = (over: Partial<DailyFunnelPayload> = {}): DailyFunnelPayload => ({
  dateKey: "2026-07-24",
  computedAt: "2026-07-24T20:00:00.000Z",
  bars: { MES: 206, MNQ: 206 },
  funnel: {},
  streams: [
    { key: "A", label: "zone-v5 MES+MNQ", tier: "A", status: "active", signalsToday: 0 },
    { key: "B:rsi-reversion:MES", label: "rsi-reversion MES", tier: "B", status: "active", signalsToday: 0 },
  ],
  staleData: false,
  worstBarAgeMin: 11,
  ...over,
});

describe("summarizeDailyFunnel", () => {
  it("says so plainly when the bot has not run yet", () => {
    const s = summarizeDailyFunnel(null);
    expect(s.sentence).toBe("Today's check has not run yet.");
    expect(s.blockers).toEqual([]);
    expect(s.barsChecked).toBe(0);
  });

  it("counts bars across both markets", () => {
    expect(summarizeDailyFunnel(payload()).barsChecked).toBe(412);
  });

  it("produces the shape the brief asked for", () => {
    const s = summarizeDailyFunnel(
      payload({ funnel: { nesting: 2, riskUnfit: 1, qualified: 0, noTouch: 3, hours: 900 } })
    );
    expect(s.sentence).toContain("412 bars checked");
    expect(s.sentence).toContain("0 qualified");
    expect(s.sentence).toContain("2 by no matching 1H zone");
    expect(s.sentence).toContain("1 by risk did not fit");
  });

  it("keeps the loud structural reasons out of the sentence but in the table", () => {
    const s = summarizeDailyFunnel(
      payload({ funnel: { hours: 900, noSignal: 800, noHtf: 700, nesting: 2 } })
    );
    // The sentence names the actionable gate, not the ones true of every bar.
    expect(s.sentence).toContain("2 by no matching 1H zone");
    expect(s.sentence).not.toContain("outside trading hours");
    // ...but the table still shows all of them, ranked.
    expect(s.blockers[0].reason).toBe("hours");
    expect(s.blockers.map((b) => b.reason)).toContain("noHtf");
    expect(s.blockers.map((b) => b.reason)).toContain("noSignal");
  });

  it("never lists a pipeline reason as a blocker", () => {
    const s = summarizeDailyFunnel(
      payload({ funnel: { evaluated: 412, qualified: 2, refined15: 30, nyCaution: 8, nesting: 1 } })
    );
    expect(s.blockers.map((b) => b.reason)).toEqual(["nesting"]);
  });

  it("counts zones touched as everything past the touch gate", () => {
    const s = summarizeDailyFunnel(
      payload({ funnel: { noTouch: 40, qualified: 2, intermarket: 1, invalidFill: 1 } })
    );
    expect(s.zonesTouched).toBe(4); // 2 + 1 + 1; the 40 still waiting do not count
    expect(s.qualified).toBe(2);
  });

  it("leads with the good news when ideas were posted", () => {
    const s = summarizeDailyFunnel(
      payload({
        funnel: { qualified: 2, nesting: 5 },
        streams: [
          { key: "A", label: "zone-v5 MES+MNQ", tier: "A", status: "active", signalsToday: 0 },
          { key: "B:rsi-reversion:MES", label: "rsi-reversion MES", tier: "B", status: "active", signalsToday: 2 },
        ],
      })
    );
    expect(s.signalsToday).toBe(2);
    expect(s.sentence).toContain("2 ideas posted");
    expect(s.sentence).not.toContain("nothing qualified");
  });

  it("distinguishes 'nothing came close' from 'blocked'", () => {
    expect(summarizeDailyFunnel(payload({ funnel: {} })).sentence).toContain(
      "nothing qualified, and nothing came close"
    );
  });

  it("surfaces a stalled feed, because that is a different answer entirely", () => {
    const s = summarizeDailyFunnel(payload({ staleData: true, worstBarAgeMin: 104 }));
    expect(s.sentence).toContain("price feed stalled");
    expect(s.sentence).toContain("104 min old");
  });

  it("says when a stream is benched, so quiet is not mistaken for broken", () => {
    const s = summarizeDailyFunnel(
      payload({
        streams: [
          { key: "A", label: "zone-v5 MES+MNQ", tier: "A", status: "benched", signalsToday: 0 },
          { key: "B:rsi-reversion:MES", label: "rsi-reversion MES", tier: "B", status: "active", signalsToday: 0 },
        ],
      })
    );
    expect(s.sentence).toContain("1 stream is benched");
  });

  it("uses the existing versioned stat table, so it needs no migration", () => {
    expect(DAILY_FUNNEL_STAT_KEY).toBe("daily_funnel");
  });
});
