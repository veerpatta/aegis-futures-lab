import { describe, expect, it } from "vitest";
import {
  SESSIONS,
  bySession,
  byWeekday,
  closedRows,
  dailyPnl,
  monthCalendar,
  monthsWithData,
  sessionOf,
  sliceStats,
  yearHeatmap,
  type ReviewRow,
} from "@/lib/review/aggregate";

/* Review aggregation. The calendar and heatmap are grid maths, which is
   exactly the kind of code that looks right and is off by one — so the
   alignment is asserted rather than eyeballed. */

/* 09:30 ET = 13:30 UTC during EDT. 2026-06-01 was a Monday. */
const etSec = (dayOffset: number, etHour: number, etMin = 0): number =>
  Date.UTC(2026, 5, 1 + dayOffset, etHour + 4, etMin) / 1000;

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  signal_ts: new Date(etSec(0, 10) * 1000).toISOString(),
  exit_ts: new Date(etSec(0, 11) * 1000).toISOString(),
  pnl_usd: 100,
  symbol: "MES",
  tier: "B",
  regime: "trend-high-vol",
  ...over,
});

describe("closedRows", () => {
  it("keeps only finished trades", () => {
    expect(closedRows([row(), row({ pnl_usd: null })])).toHaveLength(1);
  });

  it("excludes suppressed and stale rows, matching the headline stats", () => {
    const rows = [row(), row({ suppressed: true }), row({ stale_data: true })];
    expect(closedRows(rows)).toHaveLength(1);
  });
});

describe("dailyPnl", () => {
  it("groups by the NY trading date, not the UTC date", () => {
    /* 20:00 ET on 2026-06-01 is 00:00 UTC on 2026-06-02. Grouping by UTC
       would file this under the wrong session. */
    const late = row({
      signal_ts: new Date(etSec(0, 20) * 1000).toISOString(),
      exit_ts: new Date(etSec(0, 20, 30) * 1000).toISOString(),
    });
    expect(dailyPnl([late])[0].dateKey).toBe("2026-06-01");
  });

  it("uses the exit date, since that is when the trade landed", () => {
    const overnight = row({
      signal_ts: new Date(etSec(0, 14) * 1000).toISOString(),
      exit_ts: new Date(etSec(1, 10) * 1000).toISOString(),
    });
    expect(dailyPnl([overnight])[0].dateKey).toBe("2026-06-02");
  });

  it("falls back to the signal time when the exit was never stamped", () => {
    expect(dailyPnl([row({ exit_ts: null })])[0].dateKey).toBe("2026-06-01");
  });

  it("sums net and counts wins per day", () => {
    const days = dailyPnl([row({ pnl_usd: 100 }), row({ pnl_usd: -40 }), row({ pnl_usd: 0 })]);
    expect(days).toHaveLength(1);
    expect(days[0].net).toBe(60);
    expect(days[0].trades).toBe(3);
    expect(days[0].wins).toBe(1); // a scratch is not a win
  });

  it("comes back in date order", () => {
    const days = dailyPnl([
      row({ exit_ts: new Date(etSec(3, 11) * 1000).toISOString() }),
      row({ exit_ts: new Date(etSec(1, 11) * 1000).toISOString() }),
    ]);
    expect(days.map((d) => d.dateKey)).toEqual(["2026-06-02", "2026-06-04"]);
  });
});

describe("monthCalendar", () => {
  const days = dailyPnl([row({ pnl_usd: 250 })]); // 2026-06-01
  const cells = monthCalendar(days, "2026-06");

  it("is a whole number of Monday-first weeks", () => {
    expect(cells.length % 7).toBe(0);
  });

  it("puts the 1st of June 2026 in the Monday column", () => {
    // 2026-06-01 was a Monday, so there is no leading padding.
    expect(cells[0].dateKey).toBe("2026-06-01");
  });

  it("pads the front when the month does not start on a Monday", () => {
    // 2026-07-01 was a Wednesday → two blanks (Mon, Tue).
    const july = monthCalendar([], "2026-07");
    expect(july[0].dateKey).toBeNull();
    expect(july[1].dateKey).toBeNull();
    expect(july[2].dateKey).toBe("2026-07-01");
  });

  it("covers every day of the month exactly once", () => {
    const real = cells.filter((c) => c.inMonth).map((c) => c.dateKey);
    expect(real).toHaveLength(30); // June
    expect(new Set(real).size).toBe(30);
  });

  it("carries P&L onto the right day and leaves the rest null", () => {
    const hit = cells.find((c) => c.dateKey === "2026-06-01")!;
    expect(hit.net).toBe(250);
    expect(hit.trades).toBe(1);
    expect(cells.find((c) => c.dateKey === "2026-06-02")!.net).toBeNull();
  });

  it("distinguishes a flat day from a day with no trades", () => {
    /* Both render as "nothing green", so the data must keep them apart:
       0 is a day you traded to breakeven, null is a day you did not trade. */
    const flat = monthCalendar(dailyPnl([row({ pnl_usd: 0 })]), "2026-06");
    expect(flat.find((c) => c.dateKey === "2026-06-01")!.net).toBe(0);
    expect(flat.find((c) => c.dateKey === "2026-06-03")!.net).toBeNull();
  });
});

describe("monthsWithData", () => {
  it("lists months newest first, without duplicates", () => {
    const days = dailyPnl([
      row({ exit_ts: new Date(Date.UTC(2026, 4, 20, 16)).toISOString() }),
      row({ exit_ts: new Date(Date.UTC(2026, 5, 10, 16)).toISOString() }),
      row({ exit_ts: new Date(Date.UTC(2026, 5, 11, 16)).toISOString() }),
    ]);
    expect(monthsWithData(days)).toEqual(["2026-06", "2026-05"]);
  });
});

describe("yearHeatmap", () => {
  const cells = yearHeatmap([], "2026-07-31", 4);

  it("drops weekends instead of rendering two dead rows", () => {
    expect(cells.every((c) => c.weekday >= 0 && c.weekday <= 4)).toBe(true);
    for (const c of cells) {
      const dow = new Date(`${c.dateKey}T00:00:00Z`).getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1); // never Sunday
      expect(dow).toBeLessThanOrEqual(5); // never Saturday
    }
  });

  it("never runs past the end date", () => {
    for (const c of cells) expect(c.dateKey <= "2026-07-31").toBe(true);
  });

  it("lays out whole weeks in columns", () => {
    const weeks = new Set(cells.map((c) => c.weekIndex));
    expect(weeks.size).toBeLessThanOrEqual(4);
    // Every complete week column has five weekdays.
    const counts = [...weeks].map((w) => cells.filter((c) => c.weekIndex === w).length);
    expect(counts.filter((n) => n === 5).length).toBeGreaterThanOrEqual(3);
  });

  it("carries P&L onto the matching day", () => {
    const days = dailyPnl([
      row({ exit_ts: new Date(Date.UTC(2026, 6, 29, 16)).toISOString(), pnl_usd: -75 }),
    ]);
    const filled = yearHeatmap(days, "2026-07-31", 4).find((c) => c.dateKey === "2026-07-29");
    expect(filled?.net).toBe(-75);
  });
});

describe("sessionOf", () => {
  it("maps NY minutes onto the named sessions", () => {
    expect(sessionOf(etSec(0, 10)).key).toBe("nyOpen"); // 10:00 ET
    expect(sessionOf(etSec(0, 12)).key).toBe("lunch");
    expect(sessionOf(etSec(0, 14)).key).toBe("nyClose");
    expect(sessionOf(etSec(0, 4)).key).toBe("london");
    expect(sessionOf(etSec(0, 1)).key).toBe("overnight");
  });

  it("covers the whole clock with no gaps", () => {
    for (let m = 0; m < 1440; m += 7) {
      const hit = SESSIONS.find((s) => m >= s.fromMin && m < s.toMin);
      expect(hit, `minute ${m} falls in no session`).toBeDefined();
    }
  });
});

describe("slices", () => {
  const rows = [
    row({ signal_ts: new Date(etSec(0, 10) * 1000).toISOString(), pnl_usd: 100 }), // NY open, Mon
    row({ signal_ts: new Date(etSec(0, 12) * 1000).toISOString(), pnl_usd: -60 }), // lunch, Mon
    row({ signal_ts: new Date(etSec(1, 10) * 1000).toISOString(), pnl_usd: 40 }), // NY open, Tue
  ];

  it("splits by session, keeping chronological order", () => {
    const s = bySession(rows);
    expect(s.map((x) => x.key)).toEqual(["nyOpen", "lunch"]);
    expect(s[0].net).toBe(140);
    expect(s[1].net).toBe(-60);
  });

  it("gives every bucket its own n, which will be tiny", () => {
    for (const s of bySession(rows)) {
      expect(s.rate.n).toBeGreaterThan(0);
      // The whole reason the gate exists: these start below 30 and stay there.
      expect(s.rate.verdict).toBe("previewed");
    }
  });

  it("splits by weekday in week order", () => {
    const w = byWeekday(rows);
    expect(w.map((x) => x.label)).toEqual(["Monday", "Tuesday"]);
  });

  it("skips rows whose key is null rather than inventing a bucket", () => {
    const mixed = [row({ regime: null }), row({ regime: "trend-high-vol" })];
    const stats = sliceStats(mixed, (r) => (r.regime ? { key: r.regime, label: r.regime } : null));
    expect(stats).toHaveLength(1);
  });

  it("computes expectancy and PF through the shared helpers", () => {
    const [nyOpen] = bySession(rows);
    expect(nyOpen.expectancy).toBeCloseTo(70, 6); // (100 + 40) / 2
    expect(nyOpen.pf).toBeNull(); // no losses in that bucket yet
  });
});
