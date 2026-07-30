import { describe, expect, it } from "vitest";
import {
  MIN_JUDGED_N,
  MIN_VERDICT_N,
  bandVerdict,
  countLosses,
  countWins,
  expectancy,
  isJudged,
  profitFactor,
  rateFromPnls,
  rateReadout,
  sampleVerdict,
  wilsonInterval,
  winRatePct,
} from "../lib/stats";
import { metricsFromTrades } from "../lib/backtest/metrics";
import type { Trade } from "../lib/types";

/* The sample gate and its confidence interval. The app's whole claim to
   honesty rests on these being right at SMALL n — that is the only regime it
   has (24 closed signals, all tier B) and the regime where the textbook
   normal approximation misbehaves. */

describe("sampleVerdict", () => {
  it("treats nothing-logged as empty, not as a failing zero", () => {
    expect(sampleVerdict(0)).toBe("empty");
    expect(sampleVerdict(-1)).toBe("empty");
    expect(sampleVerdict(NaN)).toBe("empty");
  });

  it("previews anything below the display threshold", () => {
    expect(sampleVerdict(1)).toBe("previewed");
    expect(sampleVerdict(24)).toBe("previewed"); // today's real signal count
    expect(sampleVerdict(MIN_JUDGED_N - 1)).toBe("previewed");
  });

  it("judges at the threshold, not one past it", () => {
    expect(sampleVerdict(MIN_JUDGED_N)).toBe("judged");
    expect(isJudged(MIN_JUDGED_N)).toBe(true);
    expect(isJudged(MIN_JUDGED_N - 1)).toBe(false);
  });
});

describe("wilsonInterval", () => {
  it("returns null when there is nothing to bound", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(3, -2)).toBeNull();
  });

  it("matches the published Wilson bounds for a textbook case", () => {
    // Wilson 95% for = 0.4, n = 100 → 0.3094 … 0.4979
    const ci = wilsonInterval(40, 100)!;
    expect(ci.lo).toBeCloseTo(0.3094, 3);
    expect(ci.hi).toBeCloseTo(0.4979, 3);
  });

  it("never claims certainty from a perfect small sample", () => {
    // The Wald interval reports 100% ± 0 here. That is the bug Wilson fixes.
    const ci = wilsonInterval(8, 8)!;
    expect(ci.hi).toBe(1);
    expect(ci.lo).toBeGreaterThan(0.6);
    expect(ci.lo).toBeLessThan(0.72); // ≈ 0.676 — wide, because 8 is not many
  });

  it("stays inside [0,1] at the extremes", () => {
    for (const [k, n] of [
      [0, 1],
      [1, 1],
      [0, 24],
      [24, 24],
      [0, 5],
    ] as const) {
      const ci = wilsonInterval(k, n)!;
      expect(ci.lo).toBeGreaterThanOrEqual(0);
      expect(ci.hi).toBeLessThanOrEqual(1);
      expect(ci.lo).toBeLessThanOrEqual(ci.hi);
    }
  });

  it("narrows as n grows at the same proportion", () => {
    const width = (k: number, n: number) => {
      const ci = wilsonInterval(k, n)!;
      return ci.hi - ci.lo;
    };
    expect(width(6, 12)).toBeGreaterThan(width(50, 100));
    expect(width(50, 100)).toBeGreaterThan(width(500, 1000));
  });

  it("clamps successes into range rather than producing nonsense", () => {
    expect(wilsonInterval(30, 10)).toEqual(wilsonInterval(10, 10));
    expect(wilsonInterval(-5, 10)).toEqual(wilsonInterval(0, 10));
  });
});

describe("win / loss counting", () => {
  it("a scratch trade is neither a win nor a loss", () => {
    const pnls = [100, -50, 0];
    expect(countWins(pnls)).toBe(1);
    expect(countLosses(pnls)).toBe(1);
  });

  it("winRatePct is null on an empty sample rather than 0%", () => {
    expect(winRatePct(0, 0)).toBeNull();
    expect(winRatePct(1, 2)).toBe(50);
  });
});

describe("expectancy", () => {
  it("is null on an empty sample", () => {
    expect(expectancy([])).toBeNull();
  });

  it("is the mean P&L per trade", () => {
    expect(expectancy([100, -50, 0])).toBeCloseTo(50 / 3, 10);
  });

  it("separates a high win rate from a profitable one", () => {
    // 70% winners at small size still loses money — the reason expectancy
    // leads and win rate is subordinate.
    const pnls = [10, 10, 10, 10, 10, 10, 10, -100, -100, -100];
    expect(winRatePct(countWins(pnls), pnls.length)).toBe(70);
    expect(expectancy(pnls)!).toBeLessThan(0);
  });
});

describe("rateReadout", () => {
  it("cannot render a rate without its n", () => {
    const r = rateReadout(14, 24);
    expect(r.nLabel).toBe("n=24");
    expect(r.label).toContain("n=24");
    expect(r.label).toContain("95% CI");
    expect(r.verdict).toBe("previewed");
  });

  it("renders an em dash and no interval when nothing is logged", () => {
    const r = rateReadout(0, 0);
    expect(r.valueLabel).toBe("—");
    expect(r.ci).toBeNull();
    expect(r.ciLabel).toBeNull();
    expect(r.verdict).toBe("empty");
    expect(r.label).toBe("— (n=0)");
  });

  it("brackets the point estimate with its interval", () => {
    const r = rateReadout(14, 24);
    expect(r.ci!.lo).toBeLessThan(r.value!);
    expect(r.ci!.hi).toBeGreaterThan(r.value!);
  });

  it("rateFromPnls agrees with the explicit form", () => {
    const pnls = [100, 100, -50, 0];
    expect(rateFromPnls(pnls)).toEqual(rateReadout(2, 4));
  });
});

/* ── Rule 4 cross-check ───────────────────────────────────────────────────
   lib/stats.ts works over P&L arrays (what a SignalRow gives you) and
   lib/backtest/metrics.ts works over Trade[] (what the engine gives you).
   They are two shapes of the same definitions, so they are pinned together
   here: if either drifts, this fails. The bot-vs-human comparison is only
   credible while these agree. */
describe("stats.ts agrees with backtest/metrics.ts", () => {
  const pnls = [250, -120, 80, -60, 0, 310, -200];
  const trades: Trade[] = pnls.map((pnl, i) => ({
    id: i + 1,
    symbol: "MES",
    side: "LONG",
    qty: 1,
    entryTime: 1_000 + i * 600,
    entryPrice: 5000,
    exitTime: 1_300 + i * 600,
    exitPrice: 5000 + pnl / 5,
    stop: 4990,
    target: 5020,
    exitReason: "target",
    points: pnl / 5,
    pnl,
    rMultiple: pnl / 100,
  }));

  const m = metricsFromTrades(trades, 3000);

  it("win and loss counts match", () => {
    expect(countWins(pnls)).toBe(m.wins);
    expect(countLosses(pnls)).toBe(m.losses);
  });

  it("win rate matches", () => {
    expect(winRatePct(countWins(pnls), pnls.length)).toBeCloseTo(m.winRate, 10);
  });

  it("expectancy matches", () => {
    expect(expectancy(pnls)!).toBeCloseTo(m.expectancy, 10);
  });

  it("profit factor matches", () => {
    expect(profitFactor(pnls)!).toBeCloseTo(m.profitFactor, 10);
  });
});

describe("bandVerdict (lifted from LiveVsTuning, behaviour unchanged)", () => {
  const band: [number, number] = [1.05, 1.3];

  it("collects below the verdict threshold whatever the PF looks like", () => {
    expect(bandVerdict(MIN_VERDICT_N - 1, 9.9, band)).toBe("collecting");
    expect(bandVerdict(0, null, band)).toBe("collecting");
  });

  it("treats no-losses-yet as tracking once there is enough", () => {
    expect(bandVerdict(MIN_VERDICT_N, null, band)).toBe("tracking");
  });

  it("ranks tracking / lagging / underwater against the band floor", () => {
    expect(bandVerdict(50, 1.4, band)).toBe("tracking");
    expect(bandVerdict(50, 1.05, band)).toBe("tracking"); // floor is inclusive
    expect(bandVerdict(50, 1.02, band)).toBe("lagging");
    expect(bandVerdict(50, 1.0, band)).toBe("lagging"); // break-even is not underwater
    expect(bandVerdict(50, 0.86, band)).toBe("underwater");
  });
});
