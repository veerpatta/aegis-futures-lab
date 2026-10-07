import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { checkBars, touchesFlag } from "@/lib/history/quality";
import { decisionTime, nextTick, replayIdea, streamIdeas, monthBounds, type ReplayExample } from "@/lib/history/replay";
import { buildStudyDataset } from "@/lib/history/dataset";
import { syntheticBars } from "@/lib/experiment/synthetic";
import { freshWindow } from "@/lib/experiment/learning";
import { nyTimeToUnix } from "@/lib/time/ny";
import type { Opportunity } from "@/lib/experiment/types";

const at = (d: string, hh: number, mm = 0) => nyTimeToUnix(d, hh * 60 + mm);
function bars(day: string, fromMin: number, toMin: number, price = 6000, over: Record<number, Partial<Bar>> = {}): Bar[] {
  const out: Bar[] = [];
  for (let m = fromMin; m < toMin; m += 5) {
    const t = at(day, 0, m);
    out.push({ time: t, open: price, high: price + 1, low: price - 1, close: price, ...over[t] });
  }
  return out;
}
const DAY = "2026-09-16"; // a Wednesday
const op = (over: Partial<Opportunity> = {}): Opportunity => ({
  key: "A:zone-v5:MES:1", signalId: null, symbol: "MES", side: "LONG", entry: 6000, stop: 5990, target: 6020,
  signalTs: at(DAY, 11), seenAt: at(DAY, 11, 5), exitTs: null, strategy: "zone-v5", tier: "A", regime: "trend-high-vol", vixBucket: null, score: 1, rr: 2, ...over,
});

describe("observation clock", () => {
  it("decides at the first learner check after the modeled delay, never earlier", () => {
    expect(new Date(nextTick(at(DAY, 11, 30)) * 1000).getUTCMinutes()).toBe(37);
    const t = decisionTime(op(), "observation", 1525);
    expect(t.seenAt).toBe(op().signalTs + 1525);
    expect(t.decidedAt).toBeGreaterThanOrEqual(t.seenAt);
    expect(decisionTime(op(), "strategy", 1525).decidedAt).toBe(op().signalTs + 300);
  });
});

describe("causality", () => {
  it("changing or truncating future bars cannot alter a past decision", () => {
    const all = bars(DAY, 120, 16 * 60);
    const { decidedAt } = decisionTime(op(), "observation", 1525);
    const a = replayIdea(op(), all, "observation", 1525, "2026-09", []);
    const future = all.map((b) => (b.time >= decidedAt ? { ...b, high: b.high + 50, close: b.close + 30 } : b));
    const b = replayIdea(op(), future, "observation", 1525, "2026-09", []);
    const c = replayIdea(op(), all.filter((x) => x.time < decidedAt), "observation", 1525, "2026-09", []);
    for (const r of [b, c]) {
      expect(r.reason).toBe(a.reason);
      expect(r.features).toEqual(a.features);
      expect(r.snapshotHash).toBe(a.snapshotHash);
      expect(r.infoCutoff).toBe(a.infoCutoff);
    }
    // The truncated copy has no label yet; it is not released.
    expect(c.labelReadyAt).toBeNull();
  });

  it("excludes a label not available by the cutoff, and replay rows never count as fresh", () => {
    const all = bars(DAY, 120, 16 * 60, 6000, { [at(DAY, 12)]: { high: 6025, close: 6015 } });
    const ex = replayIdea(op(), all, "observation", 1525, "2026-09", []);
    expect(ex.outcomeStatus).toBe("closed");
    expect(buildStudyDataset([ex], ex.exitTs! - 1).exclusions["label-not-ready"]).toBe(1);
    const ds = buildStudyDataset([ex], ex.exitTs! + 1);
    expect(ds.rows).toHaveLength(1);
    expect(ds.rows[0].provenance).toBe("replay");
    const fake = { key: ds.rows[0].key, opportunityKey: "x", decidedAt: ds.rows[0].decidedAt + 10, provenance: "replay" as const, pWin: null, threshold: null };
    expect(freshWindow("v", 0, [fake as never], ds.rows, [{ decisionKey: ds.rows[0].key, versionId: "v", p: 0.6, wouldTake: true }]).decisions).toBe(0);
  });
});

describe("execution through the learner's own code", () => {
  it("fills on the next bar after the decision with costs on both sides", () => {
    const all = bars(DAY, 120, 16 * 60, 6000, { [at(DAY, 12)]: { high: 6025, close: 6015 } });
    const ex = replayIdea(op(), all, "observation", 1525, "2026-09", []);
    expect(ex.fillTs!).toBeGreaterThanOrEqual(ex.decidedAt);
    expect(ex.fillPrice).toBe(6000.25);
    expect(ex.exitReason).toBe("target");
    expect(ex.feesPc).toBe(2.4);
    expect(ex.slipPc).toBeGreaterThan(0);
  });

  it("takes the stop on an ambiguous bar and fills a gap at the open", () => {
    const amb = replayIdea(op(), bars(DAY, 120, 16 * 60, 6000, { [at(DAY, 12)]: { high: 6025, low: 5985 } }), "observation", 1525, "2026-09", []);
    expect(amb.exitReason).toBe("stop");
    expect(amb.ambiguous).toBe(true);
    const gap = replayIdea(op(), bars(DAY, 120, 16 * 60, 6000, { [at(DAY, 12)]: { open: 5980, high: 5982, low: 5975, close: 5978 } }), "observation", 1525, "2026-09", []);
    expect(gap.exitPrice).toBe(5979.75);
  });

  it("skips ideas already finished, too risky for one contract, after the session, or on stale prices", () => {
    expect(replayIdea(op({ exitTs: at(DAY, 11, 10) }), bars(DAY, 120, 16 * 60), "observation", 1525, "2026-09", []).reason).toBe("idea-closed");
    const wide = replayIdea(op({ stop: 5970 }), bars(DAY, 120, 16 * 60), "observation", 1525, "2026-09", []);
    expect(wide.reason).toBe("risk-budget");
    expect(buildStudyDataset([wide], Infinity).exclusions["over-risk"]).toBe(1);
    expect(replayIdea(op({ signalTs: at(DAY, 15, 10) }), bars(DAY, 120, 16 * 60), "observation", 1525, "2026-09", []).reason).toBe("session-over");
    const stale = bars(DAY, 120, 10 * 60).concat(bars(DAY, 13 * 60, 16 * 60));
    expect(replayIdea(op(), stale, "observation", 1525, "2026-09", []).reason).toBe("stale-data");
  });
});

describe("data handling", () => {
  it("drops duplicate copies, flags bad OHLC, gaps and contract-roll jumps without repairing them", () => {
    const base = bars(DAY, 120, 16 * 60);
    const withDup = [...base, base[10]];
    expect(checkBars(withDup, "MES").report.duplicates).toBe(1);
    const bad = base.map((b, i) => (i === 20 ? { ...b, high: b.low - 1 } : b));
    expect(checkBars(bad, "MES").report.ohlcBad).toBe(1);
    const gappy = base.filter((_, i) => i < 40 || i > 50);
    const g = checkBars(gappy, "MES").report;
    expect(g.gaps).toBe(1);
    expect(g.missingBars).toBe(11); // indices 40..50
    const jump = base.map((b, i) => (i >= 60 ? { ...b, open: b.open + 93.25, high: b.high + 93.25, low: b.low + 93.25, close: b.close + 93.25 } : b));
    const j = checkBars(jump, "MES");
    expect(j.report.discontinuities).toBe(1);
    expect(touchesFlag(j.report.windows, base[55].time, base[65].time)).not.toBeNull();
    const ex = replayIdea(op({ signalTs: base[58].time }), j.clean, "observation", 1525, "2026-09", j.report.windows);
    expect(ex.quarantined).toBe(true);
    expect(buildStudyDataset([ex], Infinity).exclusions.quarantined + buildStudyDataset([ex], Infinity).exclusions["structural-void"]).toBe(1);
  });

  it("counts each idea once across modes and copies", () => {
    const all = bars(DAY, 120, 16 * 60, 6000, { [at(DAY, 12)]: { high: 6025, close: 6015 } });
    const a = replayIdea(op(), all, "observation", 1525, "2026-09", []);
    const s = replayIdea(op(), all, "strategy", 1525, "2026-09", []);
    const ds = buildStudyDataset([a, { ...a }, s] as ReplayExample[], Infinity);
    expect(ds.rows).toHaveLength(1);
    expect(ds.exclusions["duplicate-family"]).toBe(1);
    expect(ds.exclusions["other-mode"]).toBe(1);
  });
});

describe("frozen tier streams over archive-like bars", () => {
  it("emit only ideas whose entry falls inside the chunk month", () => {
    const { start, end } = monthBounds("2026-03");
    const b = syntheticBars(7, "MES", start - 60 * 86400, end + 2 * 86400);
    const ideas = streamIdeas(b, "MES", start, end, []);
    for (const i of ideas) {
      expect(i.signalTs).toBeGreaterThanOrEqual(start);
      expect(i.signalTs).toBeLessThan(end);
      expect(i.key).toMatch(/^[AB]:[a-z0-9-]+:MES:\d+$/);
    }
    // Deterministic.
    expect(streamIdeas(b, "MES", start, end, [])).toEqual(ideas);
  });
});
