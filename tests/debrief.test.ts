import { describe, expect, it } from "vitest";
import { buildDebrief, judgedRows, topFunnelReasons, type DebriefRow } from "@/scripts/engine/debrief-copy";

/* The nightly report card. Composed deterministically, so it is testable —
   which is the point of composing it deterministically. */

const row = (over: Partial<DebriefRow> = {}): DebriefRow => ({
  symbol: "MES",
  tier: "B",
  status: "hit_target",
  pnl_usd: 100,
  signal_ts: "2026-07-30T14:00:00.000Z",
  ...over,
});

const base = { dateKey: "2026-07-30", engineHealthy: true };

describe("judgedRows", () => {
  it("counts only finished, unsuppressed, non-stale rows", () => {
    const rows = [row(), row({ pnl_usd: null }), row({ suppressed: true }), row({ stale_data: true })];
    expect(judgedRows(rows)).toHaveLength(1);
  });
});

describe("buildDebrief — a day with trades", () => {
  const text = buildDebrief({
    ...base,
    rows: [row({ pnl_usd: 120 }), row({ pnl_usd: -40 }), row({ symbol: "MNQ", pnl_usd: 60 })],
  });

  it("leads with what happened, in money", () => {
    expect(text).toContain("Report card — 2026-07-30");
    expect(text).toContain("made $140.00");
    expect(text).toContain("3 trades");
    expect(text).toContain("2 up, 1 down");
  });

  it("puts expectancy above win rate", () => {
    expect(text.indexOf("Expectancy")).toBeLessThan(text.indexOf("Win rate"));
  });

  it("never states a win rate without its n", () => {
    expect(text).toMatch(/Win rate: \d+% \(n=3/);
  });

  it("splits by market when both traded", () => {
    expect(text).toContain("MES");
    expect(text).toContain("MNQ");
  });

  it("says a single day is not evidence, even on a good day", () => {
    /* The report card is exactly where a reader is most tempted to
       over-read, so the caveat is unconditional rather than only on bad
       days. */
    expect(text).toContain("previewed, not judged");
  });
});

describe("buildDebrief — a losing day still tells the truth plainly", () => {
  it("says lost, with the amount", () => {
    const text = buildDebrief({ ...base, rows: [row({ pnl_usd: -80 }), row({ pnl_usd: -20 })] });
    expect(text).toContain("lost $100.00");
    expect(text).toContain("0 up, 2 down");
  });

  it("does not editorialise or advise", () => {
    const text = buildDebrief({ ...base, rows: [row({ pnl_usd: -500 })] });
    expect(text.toLowerCase()).not.toMatch(/tomorrow|revenge|don't worry|bounce back|try/);
  });
});

describe("buildDebrief — a quiet day", () => {
  const text = buildDebrief({
    ...base,
    rows: [],
    funnel: { noTouch: 40, nesting: 12, hours: 5, evaluated: 900 },
    barsSeen: 276,
  });

  it("says no trades rather than showing an empty results table", () => {
    expect(text).toContain("No trades today.");
    expect(text).not.toContain("Win rate");
  });

  it("explains why, in the trader's language not the engine's", () => {
    expect(text).toContain("price never reached a zone (40×)");
    expect(text).toContain("no daily or 4-hour zone in range (12×)");
    // "evaluated" is pipeline chatter, not a reason a trade was skipped.
    expect(text).not.toContain("evaluated");
  });

  it("frames waiting as the strategy working", () => {
    expect(text).toContain("276 five-minute candles");
    expect(text).toContain("That is the strategy working, not failing.");
  });

  it("mentions still-open ideas rather than implying nothing happened", () => {
    const open = buildDebrief({ ...base, rows: [row({ pnl_usd: null })] });
    expect(open).toContain("No trades finished today");
    expect(open).toContain("1 idea still open");
  });
});

describe("buildDebrief — engine health leads when it is bad", () => {
  it("warns before the numbers, because a quiet day and a broken engine look alike", () => {
    const text = buildDebrief({ ...base, engineHealthy: false, rows: [row()] });
    expect(text).toContain("did not run cleanly");
    expect(text.indexOf("did not run cleanly")).toBeLessThan(text.indexOf("Expectancy"));
  });

  it("says nothing about health on a clean day", () => {
    expect(buildDebrief({ ...base, rows: [row()] })).not.toContain("did not run cleanly");
  });
});

describe("buildDebrief — excluded rows are declared, not hidden", () => {
  it("names suppressed and stale rows under the result", () => {
    const text = buildDebrief({
      ...base,
      rows: [row(), row({ suppressed: true }), row({ stale_data: true, pnl_usd: 900 })],
    });
    expect(text).toContain("Excluded above");
    expect(text).toContain("1 row from a benched stream");
    expect(text).toContain("1 row computed on delayed bars");
    // The excluded +900 must not reach the headline.
    expect(text).toContain("made $100.00");
  });
});

describe("topFunnelReasons", () => {
  it("ranks by frequency and caps the list", () => {
    const out = topFunnelReasons({ noTouch: 5, nesting: 50, hours: 20, lock: 1 });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("no daily or 4-hour zone in range");
  });

  it("ignores reasons that explain nothing", () => {
    expect(topFunnelReasons({ evaluated: 999, qualified: 5 })).toEqual([]);
  });

  it("is empty when the funnel is", () => {
    expect(topFunnelReasons({})).toEqual([]);
  });
});
