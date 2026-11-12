import { describe, expect, it } from "vitest";
import { mismatchOf, refPriceAt } from "@/lib/tm-study/historical";
import { historicalLook, dueForwardLook, type TmRow } from "@/lib/tm-study/score";
import { TM_HIST_STUDY, TM_FWD_STUDY } from "@/lib/tm-study/rules";
import type { ReplayExample } from "@/lib/history/replay";

const ex = (over: Partial<ReplayExample> = {}): ReplayExample =>
  ({ decidedAt: 1000, outcomeStatus: "closed", fillTs: 1200, fillPrice: 6800, exitTs: 3000, exitPrice: 6810, exitReason: "target", netPc: 45.1, ...over }) as ReplayExample;

describe("historical regeneration checks", () => {
  it("accepts an identical outcome and names the first field that differs", () => {
    expect(mismatchOf(ex(), ex())).toBeNull();
    expect(mismatchOf(ex(), ex({ decidedAt: 1300 }))).toBe("decision time");
    expect(mismatchOf(ex(), ex({ fillPrice: 6800.25 }))).toBe("fill");
    expect(mismatchOf(ex(), ex({ exitReason: "stop" }))).toBe("exit");
    expect(mismatchOf(ex(), ex({ netPc: 45.2 }))).toBe("result");
  });

  it("uses the close of the last bar closed by the decision, as the learner does", () => {
    const bars = [0, 300, 600, 900].map((t, i) => ({ time: t, open: 1, high: 1, low: 1, close: 10 + i, volume: 0 }));
    expect(refPriceAt(bars, 900)).toBe(12); // the 600 bar closes at 900; the 900 bar is still open
    expect(refPriceAt(bars, 1200)).toBe(13);
    expect(refPriceAt(bars, 299)).toBeNull();
    expect(refPriceAt(bars, 900 + 4 * 86400)).toBeNull(); // nothing within 3 days
  });
});

/* 50 sessions × 4 ideas: in each session two win $40 and two lose $30. */
function rows(skip: (win: boolean, i: number) => boolean): TmRow[] {
  const out: TmRow[] = [];
  for (let s = 0; s < 50; s++)
    for (let i = 0; i < 4; i++) {
      const win = i < 2;
      out.push({ key: `k${s}-${i}`, session: `2026-01-${String(s).padStart(3, "0")}`, order: s * 10 + i, state: "resolved", skip: skip(win, s * 4 + i), net: win ? 40 : -30 });
    }
  return out;
}

describe("time machine filter scoring", () => {
  it("passes a filter that skips only losers (45% of ideas, all after costs)", () => {
    const r = historicalLook(rows((win, i) => !win && i % 20 !== 3), TM_HIST_STUDY);
    expect(r.verdict).toBe("pass");
    expect(r.keptNet).toBeGreaterThan(0);
    expect(r.randomPercentile).toBeGreaterThanOrEqual(95);
  });

  it("fails a filter that skips only winners", () => {
    expect(historicalLook(rows((win) => win), TM_HIST_STUDY).verdict).toBe("fail");
  });

  it("does not pass a filter that skips almost nothing, however good", () => {
    const r = historicalLook(rows((win, i) => !win && i < 8), TM_HIST_STUDY);
    expect(r.skipRate).toBeLessThan(0.1);
    expect(r.verdict).not.toBe("pass");
  });

  it("waits for the first forward look until 60 resolved decisions over 15 sessions exist", () => {
    const few = rows(() => false).slice(0, 40);
    const r = dueForwardLook(few, [], TM_FWD_STUDY, 0);
    expect("waiting" in r && r.waiting).toMatch(/Look 1: 40 of 60 resolved/);
    const enough = dueForwardLook(rows((win) => !win), [], TM_FWD_STUDY, 10_000);
    expect("due" in enough && enough.due.look).toBe(1);
  });
});
