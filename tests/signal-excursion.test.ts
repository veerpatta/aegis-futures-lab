import { describe, it, expect } from "vitest";
import { excursionRow, hasExcursion } from "@/lib/signals/excursion";
import { maeR, mfeR } from "@/lib/backtest/metrics";
import type { Trade } from "@/lib/types";

/* The row builder for `signal_excursion`.

   The table's whole reason to exist is that live excursion cannot be rebuilt
   once the feed drops the bars, so the failure that matters here is a row that
   looks measured but isn't — an all-nulls row for a trade that never carried
   the fields, or an R normalised against the wrong stop. Both are silent. */

const BAR = 300;

const mkTrade = (over: Partial<Trade>): Trade => ({
  id: 1,
  symbol: "MES",
  side: "LONG",
  qty: 1,
  entryTime: 1000,
  entryPrice: 5000,
  exitTime: 1000 + 6 * BAR,
  exitPrice: 5010,
  stop: 4990,
  target: 5020,
  exitReason: "target",
  points: 10,
  pnl: 48,
  rMultiple: 1,
  maePoints: 5,
  mfePoints: 15,
  maeTime: 1000 + 2 * BAR,
  mfeTime: 1000 + 5 * BAR,
  atrAtEntry: 10,
  ...over,
});

describe("hasExcursion", () => {
  it("is true for a trade the engine measured", () => {
    expect(hasExcursion(mkTrade({}))).toBe(true);
  });

  it("is false for a trade reconstructed from stored rows", () => {
    // These predate the fields. A row of nulls would record "measured, found
    // nothing" where the truth is "never measured".
    expect(hasExcursion(mkTrade({ maePoints: undefined, mfePoints: undefined }))).toBe(false);
  });

  it("is true when only one side is present", () => {
    expect(hasExcursion(mkTrade({ mfePoints: undefined }))).toBe(true);
  });
});

describe("excursionRow", () => {
  it("carries the ids and source it was given", () => {
    const row = excursionRow(42, mkTrade({}), "yahoo", "2026-08-17T00:00:00.000Z");
    expect(row.signal_id).toBe(42);
    expect(row.bar_source).toBe("yahoo");
    expect(row.computed_at).toBe("2026-08-17T00:00:00.000Z");
  });

  it("records points as the engine measured them", () => {
    const row = excursionRow(1, mkTrade({}), "yahoo", "t");
    expect(row.mae_points).toBe(5);
    expect(row.mfe_points).toBe(15);
    expect(row.atr_at_entry).toBe(10);
  });

  it("normalises by ATR at entry", () => {
    const row = excursionRow(1, mkTrade({}), "yahoo", "t");
    expect(row.mae_atr).toBeCloseTo(0.5, 6); // 5 / 10
    expect(row.mfe_atr).toBeCloseTo(1.5, 6); // 15 / 10
  });

  it("normalises R by the stop AT ENTRY, not the trailed stop", () => {
    /* The defect this guards: `stop` is the FINAL stop, so a trade trailed to
       breakeven has |entry - stop| -> 0 and maeR -> infinity. metrics.ts owns
       this via stopPoints(); the row must inherit it rather than re-derive. */
    const trailed = mkTrade({ initialStop: 4990, stop: 5000 });
    const row = excursionRow(1, trailed, "yahoo", "t");
    expect(row.mae_r).toBeCloseTo(0.5, 6); // 5 / 10, not 5 / 0
    expect(row.mfe_r).toBeCloseTo(1.5, 6);
    expect(Number.isFinite(row.mae_r!)).toBe(true);
  });

  it("agrees with metrics.ts rather than holding a second definition", () => {
    const t = mkTrade({ entryPrice: 20000, stop: 19960, maePoints: 40, mfePoints: 80 });
    const row = excursionRow(1, t, "yahoo", "t");
    expect(row.mae_r).toBeCloseTo(maeR(t)!, 4);
    expect(row.mfe_r).toBeCloseTo(mfeR(t)!, 4);
  });

  it("expresses time to each extreme in minutes from entry", () => {
    const row = excursionRow(1, mkTrade({}), "yahoo", "t");
    expect(row.minutes_to_mae).toBeCloseTo(10, 6); // 2 bars
    expect(row.minutes_to_mfe).toBeCloseTo(25, 6); // 5 bars
  });

  it("counts holding time in bars", () => {
    expect(excursionRow(1, mkTrade({}), "yahoo", "t").bars_held).toBe(6);
  });

  it("nulls the normalisations rather than emitting Infinity or NaN", () => {
    // No ATR (series warm-up) and no usable stop distance.
    const t = mkTrade({ atrAtEntry: undefined, stop: 5000, initialStop: 5000 });
    const row = excursionRow(1, t, "yahoo", "t");
    expect(row.mae_atr).toBeNull();
    expect(row.mfe_atr).toBeNull();
    expect(row.mae_r).toBeNull();
    expect(row.mfe_r).toBeNull();
    // The raw points survive — they were measured.
    expect(row.mae_points).toBe(5);
  });

  it("keeps a one-sided measurement instead of dropping it", () => {
    const row = excursionRow(1, mkTrade({ mfePoints: undefined, mfeTime: undefined }), "yahoo", "t");
    expect(row.mae_points).toBe(5);
    expect(row.mfe_points).toBeNull();
    expect(row.minutes_to_mfe).toBeNull();
  });
});
