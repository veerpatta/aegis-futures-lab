import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCIPLINE,
  disciplineDays,
  disciplineStreak,
  oversized,
  recentBreaks,
} from "@/lib/journal/discipline";
import { DEFAULT_COMMISSION_PER_CONTRACT, journalPnl, type JournalTrade } from "@/lib/journal";

/* The streak measures rule adherence, not luck. The single most important
   assertion in this file is that a LOSING but clean day extends the chain —
   without it this is the P&L streak again wearing a different label. */

/* 2026-06-01 was a Monday. 09:30 ET = 13:30 UTC in EDT. */
const at = (dayOffset: number, etHour: number, etMin = 0): number =>
  Date.UTC(2026, 5, 1 + dayOffset, etHour + 4, etMin) / 1000;

let seq = 0;
const trade = (over: Partial<JournalTrade> = {}): JournalTrade => ({
  id: `t${++seq}`,
  symbol: "MES",
  side: "LONG",
  qty: 1,
  entryTime: at(0, 10),
  entryPrice: 5000,
  exitTime: at(0, 11),
  exitPrice: 5010,
  createdAt: 0,
  ...over,
});

describe("journalPnl now reports net, not only gross", () => {
  it("charges the same commission the engine charges itself", () => {
    const t = trade({ qty: 2, entryPrice: 5000, exitPrice: 5010 });
    const p = journalPnl(t);
    expect(p.grossPnl).toBeCloseTo(100, 6); // 10 pts × $5 × 2
    expect(p.commission).toBeCloseTo(4.8, 6); // 2.4 × 2 contracts
    expect(p.netPnl).toBeCloseTo(95.2, 6);
  });

  it("defaults to the engine's own cost so the two sides are comparable", () => {
    expect(DEFAULT_COMMISSION_PER_CONTRACT).toBe(2.4);
  });

  it("can turn a marginal winner into a loser, which is the point", () => {
    const t = trade({ qty: 1, entryPrice: 5000, exitPrice: 5000.25 });
    expect(journalPnl(t).grossPnl).toBeCloseTo(1.25, 6);
    expect(journalPnl(t).netPnl).toBeLessThan(0);
  });

  it("honours a custom commission", () => {
    expect(journalPnl(trade({ qty: 1 }), 0).netPnl).toBeCloseTo(50, 6);
  });
});

describe("oversized", () => {
  it("passes a normal position", () => {
    expect(oversized(trade({ symbol: "MES", qty: 3 }), DEFAULT_DISCIPLINE)).toBe(false);
  });

  it("catches an indefensible one", () => {
    // 40 MES contracts = $200/point, past the $160 cap on a one-point stop.
    expect(oversized(trade({ symbol: "MES", qty: 40 }), DEFAULT_DISCIPLINE)).toBe(true);
  });

  it("scales with the contract's point value", () => {
    // MNQ is $2/point, so it takes more contracts to breach the same cap.
    expect(oversized(trade({ symbol: "MNQ", qty: 40 }), DEFAULT_DISCIPLINE)).toBe(false);
    expect(oversized(trade({ symbol: "MNQ", qty: 100 }), DEFAULT_DISCIPLINE)).toBe(true);
  });
});

describe("disciplineDays", () => {
  it("marks a day with no breaks clean", () => {
    const [day] = disciplineDays([trade()]);
    expect(day.clean).toBe(true);
    expect(day.breaks).toEqual([]);
    expect(day.trades).toBe(1);
  });

  it("flags an entry outside the trading window", () => {
    const [day] = disciplineDays([trade({ entryTime: at(0, 1) })]); // 01:00 ET
    expect(day.clean).toBe(false);
    expect(day.breaks[0].rule).toBe("entryWindow");
  });

  it("allows the London session, which the live config permits", () => {
    const [day] = disciplineDays([trade({ entryTime: at(0, 3) })]); // 03:00 ET
    expect(day.clean).toBe(true);
  });

  it("flags an entry after the 15:25 flat", () => {
    const [day] = disciplineDays([trade({ entryTime: at(0, 15, 30) })]);
    expect(day.breaks[0].rule).toBe("entryWindow");
  });

  it("flags the trade that crosses the count limit, not the ones before it", () => {
    const [day] = disciplineDays([
      trade({ entryTime: at(0, 10) }),
      trade({ entryTime: at(0, 11) }),
      trade({ entryTime: at(0, 12) }), // the third — over the limit of 2
    ]);
    expect(day.breaks).toHaveLength(1);
    expect(day.breaks[0].rule).toBe("tradeCount");
  });

  it("counts the limit per symbol, not across the book", () => {
    const [day] = disciplineDays([
      trade({ symbol: "MES", entryTime: at(0, 10) }),
      trade({ symbol: "MES", entryTime: at(0, 11) }),
      trade({ symbol: "MNQ", entryTime: at(0, 12) }),
      trade({ symbol: "MNQ", entryTime: at(0, 13) }),
    ]);
    expect(day.clean).toBe(true);
  });

  it("flags trading on after the loss limit", () => {
    const loser = { entryPrice: 5000, exitPrice: 4990 };
    const [day] = disciplineDays([
      trade({ entryTime: at(0, 9), ...loser }),
      trade({ entryTime: at(0, 10), ...loser }),
      trade({ entryTime: at(0, 11), ...loser }),
    ]);
    const rules = day.breaks.map((b) => b.rule);
    expect(rules).toContain("afterLossLimit");
  });

  it("judges losses on NET, so a commission-only loss still counts", () => {
    // Gross +1.25, net negative. Two of these should trip the loss limit.
    const scratch = { entryPrice: 5000, exitPrice: 5000.25 };
    const [day] = disciplineDays([
      trade({ entryTime: at(0, 9), ...scratch }),
      trade({ entryTime: at(0, 10), ...scratch }),
      trade({ entryTime: at(0, 11), ...scratch }),
    ]);
    expect(day.breaks.map((b) => b.rule)).toContain("afterLossLimit");
  });

  it("splits trades into NY trading days", () => {
    const days = disciplineDays([trade({ entryTime: at(0, 10) }), trade({ entryTime: at(1, 10) })]);
    expect(days).toHaveLength(2);
    expect(days[0].dateKey < days[1].dateKey).toBe(true);
  });
});

describe("disciplineStreak", () => {
  const clean = (d: number) => trade({ entryTime: at(d, 10) });
  const breaking = (d: number) => trade({ entryTime: at(d, 1) }); // outside window

  it("THE point: a losing but clean day keeps the chain alive", () => {
    const days = disciplineDays([
      clean(0),
      trade({ entryTime: at(1, 10), entryPrice: 5000, exitPrice: 4900 }), // big loss, no break
      clean(2),
    ]);
    const s = disciplineStreak(days);
    expect(days[1].netPnl).toBeLessThan(0);
    expect(days[1].clean).toBe(true);
    expect(s.current).toBe(3);
  });

  it("a profitable day that broke a rule BREAKS the chain", () => {
    const days = disciplineDays([
      clean(0),
      trade({ entryTime: at(1, 1), entryPrice: 5000, exitPrice: 5100 }), // huge win, wrong hour
    ]);
    const s = disciplineStreak(days);
    expect(days[1].netPnl).toBeGreaterThan(0);
    expect(s.current).toBe(0);
  });

  it("counts back only from the most recent day", () => {
    const days = disciplineDays([clean(0), breaking(1), clean(2), clean(3)]);
    expect(disciplineStreak(days).current).toBe(2);
  });

  it("remembers the best run in the window", () => {
    const days = disciplineDays([clean(0), clean(1), clean(2), breaking(3), clean(4)]);
    const s = disciplineStreak(days);
    expect(s.best).toBe(3);
    expect(s.current).toBe(1);
  });

  it("reports nothing-logged rather than a zero streak", () => {
    const s = disciplineStreak([]);
    expect(s.daysJudged).toBe(0);
    expect(s.adherencePct).toBeNull();
    expect(s.current).toBe(0);
  });

  it("reports adherence as a share of judged days", () => {
    const days = disciplineDays([clean(0), breaking(1), clean(2), clean(3)]);
    expect(disciplineStreak(days).adherencePct).toBeCloseTo(75, 6);
  });
});

describe("recentBreaks", () => {
  it("lists the most recent breaks first, with their day", () => {
    const days = disciplineDays([
      trade({ entryTime: at(0, 1) }),
      trade({ entryTime: at(3, 1) }),
    ]);
    const list = recentBreaks(days);
    expect(list).toHaveLength(2);
    expect(list[0].dateKey > list[1].dateKey).toBe(true);
    expect(list[0].detail).toMatch(/outside the trading window/);
  });

  it("respects the limit", () => {
    const days = disciplineDays(
      Array.from({ length: 12 }, (_, i) => trade({ entryTime: at(i, 1) }))
    );
    expect(recentBreaks(days, 5)).toHaveLength(5);
  });

  it("is empty when nothing was broken", () => {
    expect(recentBreaks(disciplineDays([trade()]))).toEqual([]);
  });
});
