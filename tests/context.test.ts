import { describe, expect, it } from "vitest";
import { vixBucketFor, type ContextRow } from "../scripts/engine/context";

/* vix_bucket rule: for NY date D use the LAST context row strictly before D
   (no lookahead) and compare its VIX to the median of the trailing 20 rows
   ending there. Under 20 rows of history → null. */

const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
};

const rows = (vix: number[]): ContextRow[] =>
  vix.map((v, i) => ({ date_key: day(i), vix: v, dxy: null, tnx: null }));

describe("vixBucketFor", () => {
  it("null with fewer than 20 prior rows", () => {
    expect(vixBucketFor(rows(Array(10).fill(15)), day(10))).toBeNull();
    expect(vixBucketFor(rows(Array(19).fill(15)), day(19))).toBeNull();
  });

  it("high when the latest prior VIX sits above its trailing median", () => {
    // 19 calm days at 15, then a spike to 30 — the spike day IS the latest
    // prior row and sits far above the 20-day median.
    const r = rows([...Array(19).fill(15), 30]);
    expect(vixBucketFor(r, day(20))).toBe("high");
  });

  it("low when the latest prior VIX sits at/below its trailing median", () => {
    // A fading spike: old high values, latest below the window median.
    const r = rows([...Array(10).fill(30), ...Array(10).fill(14)]);
    expect(vixBucketFor(r, day(20))).toBe("low");
  });

  it("never reads the signal day itself (no lookahead)", () => {
    // Day 20 carries a huge spike, but a signal ON day 20 must only see
    // days 0..19 (all calm at 15) → low, the spike is invisible.
    const r = rows([...Array(20).fill(15), 99]);
    expect(vixBucketFor(r, day(20))).toBe("low");
  });

  it("skips rows without a vix value", () => {
    const r = rows([...Array(21).fill(15)]);
    r[20].vix = null; // latest row unusable → falls back to day 19
    expect(vixBucketFor(r, day(21))).toBe("low");
  });
});
