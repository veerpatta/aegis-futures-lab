import { describe, it, expect } from "vitest";
import { executeRun, type RunRequest } from "@/lib/backtest/run";
import {
  compareBooks,
  describeDivergence,
  grossRequestFrom,
  runGrossNet,
} from "@/lib/backtest/grossNet";
import {
  LEGACY_MODEL,
  ZERO_COST_MODEL,
  frictionDollarsPerContract,
  roundTripCost,
} from "@/lib/costs";
import type { ExecutionConfig } from "@/lib/strategies/types";
import { resolveExecution } from "@/lib/costs";
import { EXECUTION } from "@/scripts/engine/tiers";
import type { Bar, Trade } from "@/lib/types";

/* Synthetic MES-like bars. 2026-06-01 was a Monday; 09:30 NY = 13:30 UTC. */
const OPEN_UTC = Date.UTC(2026, 5, 1, 13, 30) / 1000;

function bars(count: number, drift = 0, range = 4): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const price = 5000 + i * drift;
    return {
      time: OPEN_UTC + i * 300,
      open: price,
      high: price + range,
      low: price - range,
      close: price + drift / 2,
      volume: 100,
    };
  });
}

/* The pre-2026-08-17 EXECUTION, rebuilt explicitly.

   tiers.ts's EXECUTION now carries the corrections adopted with the Phase 1
   re-measurement (minStopPoints, restingLimitOrders, REALISTIC friction).
   The assertions below are about something else — the gross-vs-net geometry story under the legacy cost model — so they pin the legacy
   config rather than silently measuring two changes at once. Relaxing the
   thresholds instead would have been the goalpost move this repo exists to
   refuse. */
const LEGACY_EXECUTION: ExecutionConfig = resolveExecution(LEGACY_MODEL, "MES", {
  maxRisk: 160,
  sizing: "risk",
  fillModel: "limit",
});

function req(series: Bar[], overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    strategyId: "rsi-reversion",
    params: { length: 14, oversold: 30, overbought: 70, atrMult: 1.5, targetR: 1.5, session: "all" },
    series: { MES: series },
    execution: LEGACY_EXECUTION,
    locks: null,
    startingCapital: 3000,
    sessionExitMinute: 925,
    pointValues: { MES: 5 },
    ...overrides,
  };
}

describe("grossRequestFrom", () => {
  it("zeroes cost and slippage and changes nothing else", () => {
    const r = req(bars(40));
    const g = grossRequestFrom(r);
    expect(g.execution.cost).toBe(0);
    expect(g.execution.slippage).toBe(0);
    // Every other field must survive, or the two books are not comparable.
    expect(g.execution.maxRisk).toBe(r.execution.maxRisk);
    expect(g.execution.sizing).toBe(r.execution.sizing);
    expect(g.execution.fillModel).toBe(r.execution.fillModel);
    const { execution: _ge, ...gRest } = g;
    const { execution: _ne, ...nRest } = r;
    expect(gRest).toEqual(nRest);
  });

  it("does not mutate the original request", () => {
    const r = req(bars(40));
    grossRequestFrom(r);
    expect(r.execution.cost).toBe(2.4);
    expect(r.execution.slippage).toBe(0.25);
  });
});

/* ── The reconciliation identity ─────────────────────────────────────────
   Over trades both books took at the same size:

       net − gross = −commission + geometryEffect

   COMMISSION is exact — it is a flat dollar subtraction that never touches a
   price. SLIPPAGE is not, and it is worth being precise about why, because it
   is easy to report a wrong number here: slippage moves the entry FILL, which
   moves |entry − stop|, which moves an rMultiple target proportionally. The
   slipped book therefore travels further to its target and books more gross
   points, partly offsetting what it paid at the fill. So the true drag is
   smaller than nominal ticks × point value, and anything left over after
   commission is reported as geometryEffect rather than mislabelled as a
   slippage charge. */
describe("compareBooks reconciles the matched prefix", () => {
  const mk = (id: number, entryTime: number, qty: number, pnl: number): Trade =>
    ({
      id,
      symbol: "MES",
      side: "LONG",
      qty,
      entryTime,
      entryPrice: 5000,
      exitTime: entryTime + 600,
      exitPrice: 5001,
      stop: 4990,
      initialStop: 4990,
      target: null,
      exitReason: "target",
      points: 1,
      pnl,
      rMultiple: 0.1,
    }) as Trade;

  const book = (trades: Trade[]) =>
    ({ trades, equity: [], metrics: {}, skipReasons: {} }) as never;

  it("matches identical books and attributes the gap to commission", () => {
    const commission = roundTripCost(LEGACY_MODEL); // 2.40
    const gross = book([mk(1, 100, 1, 50), mk(2, 700, 1, -20)]);
    const net = book([mk(1, 100, 1, 50 - commission), mk(2, 700, 1, -20 - commission)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);

    expect(d.firstDivergenceTime).toBeNull();
    expect(d.matchedBeforeDivergence).toBe(2);
    expect(d.commissionOnMatched).toBeCloseTo(2 * commission, 9);
    expect(d.deltaMatched).toBeCloseTo(-2 * commission, 9);
    expect(d.geometryEffect).toBeCloseTo(0, 9);
    expect(d.pathEffect).toBeCloseTo(0, 9);
    expect(d.reconciles).toBe(true);
    // The nominal friction figure is larger, because it also charges slippage.
    expect(d.frictionOnMatched).toBeCloseTo(2 * frictionDollarsPerContract(LEGACY_MODEL, "MES"), 9);
    expect(d.frictionOnMatched).toBeGreaterThan(d.commissionOnMatched);
  });

  it("scales commission and friction by contract count", () => {
    const commission = roundTripCost(LEGACY_MODEL);
    const gross = book([mk(1, 100, 3, 90)]);
    const net = book([mk(1, 100, 3, 90 - 3 * commission)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);
    expect(d.commissionOnMatched).toBeCloseTo(3 * commission, 9);
    expect(d.frictionOnMatched).toBeCloseTo(3 * frictionDollarsPerContract(LEGACY_MODEL, "MES"), 9);
    expect(d.reconciles).toBe(true);
  });

  /* A book whose gap is bigger than commission alone: the residual lands in
     geometryEffect rather than being silently absorbed. */
  it("puts anything commission cannot explain into geometryEffect", () => {
    const commission = roundTripCost(LEGACY_MODEL);
    const gross = book([mk(1, 100, 1, 50)]);
    const net = book([mk(1, 100, 1, 50 - commission - 1.1)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);
    expect(d.reconciles).toBe(false);
    expect(d.geometryEffect).toBeCloseTo(-1.1, 9);
  });

  it("stops matching at a qty step and reports it", () => {
    const gross = book([mk(1, 100, 2, 50), mk(2, 700, 1, 10)]);
    const net = book([mk(1, 100, 1, 20), mk(2, 700, 1, 10)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);

    expect(d.matchedBeforeDivergence).toBe(0); // the very first trade differs in size
    expect(d.firstDivergenceTime).toBe(100);
    expect(d.qtyDiffs).toHaveLength(1);
    expect(d.qtyDiffs[0]).toMatchObject({ grossQty: 2, netQty: 1 });
  });

  it("reports trades that exist in only one book", () => {
    const gross = book([mk(1, 100, 1, 50), mk(2, 700, 1, 10)]);
    const net = book([mk(1, 100, 1, 46)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);
    expect(d.grossOnly).toEqual([{ symbol: "MES", side: "LONG", entryTime: 700 }]);
    expect(d.netOnly).toEqual([]);
    expect(d.tradesAfterDivergenceFraction).toBeCloseTo(0.5, 9);
  });

  /* net > gross is legitimate: a costlier book can skip a loser. The report
     must survive it rather than treating the sign as an invariant. */
  it("handles net outperforming gross without crashing or hiding it", () => {
    const gross = book([mk(1, 100, 1, 50), mk(2, 700, 1, -500)]);
    const net = book([mk(1, 100, 1, 46)]);
    const d = compareBooks(gross, net, LEGACY_MODEL);
    expect(d.pathEffect).toBeGreaterThan(0);
    expect(Number.isFinite(d.pathEffect)).toBe(true);
    expect(describeDivergence(d)).toMatch(/different set of trades/);
  });

  /* The qty RANGE is what distinguishes "no edge" from "an edge too small to
     survive N× friction". If every trade sizes to the same ceiling, friction
     scales linearly with contract count while edge does not. */
  it("reports the contract-count range, not just the mean", () => {
    const d = compareBooks(
      book([mk(1, 100, 2, 10)]),
      book([mk(1, 100, 2, 10), mk(2, 700, 8, 10), mk(3, 1300, 5, 10)]),
      LEGACY_MODEL,
    );
    expect(d.minNetQty).toBe(2);
    expect(d.maxNetQty).toBe(8);
    expect(d.meanNetQty).toBeCloseTo(5, 9);
  });

  it("scales friction over the whole net book by contract count", () => {
    const friction = frictionDollarsPerContract(LEGACY_MODEL, "MES");
    const d = compareBooks(
      book([]),
      book([mk(1, 100, 2, 10), mk(2, 700, 8, 10)]),
      LEGACY_MODEL,
    );
    // 10 contracts total, not 2 trades — the distinction the mean hides.
    expect(d.frictionOnNetBook).toBeCloseTo(10 * friction, 9);
  });

  it("counts common signals even when every size differs", () => {
    const d = compareBooks(
      book([mk(1, 100, 3, 10), mk(2, 700, 3, 10)]),
      book([mk(1, 100, 1, 10), mk(2, 700, 1, 10)]),
      LEGACY_MODEL,
    );
    // Lockstep matching stops at trade 0, but both books took both signals.
    expect(d.matchedBeforeDivergence).toBe(0);
    expect(d.sameKeyCount).toBe(2);
  });

  it("handles two empty books", () => {
    const d = compareBooks(book([]), book([]), LEGACY_MODEL);
    expect(d.matchedBeforeDivergence).toBe(0);
    expect(d.firstDivergenceTime).toBeNull();
    expect(d.tradesAfterDivergenceFraction).toBe(0);
    expect(d.reconciles).toBe(true);
  });
});

/* ── End to end through the real engine ──────────────────────────────────*/
describe("runGrossNet through the real simulator", () => {
  /* Five NY sessions of a 20-bar triangle wave: ten bars down 4 points, ten
     back up. Ten consecutive down closes drive RSI(14) under 30, and the
     reversal crosses it back up — which is exactly rsi-reversion's trigger.
     A sine wave does not work here: it is too smooth to reach the extremes,
     and a single 200-bar run spills past the 15:25 session exit, after which
     no entry is allowed at all. */
  const wave: Bar[] = [];
  for (let day = 0; day < 5; day++) {
    // 2026-06-01 is a Monday, so offsets 0..4 are all weekdays.
    const dayOpen = Date.UTC(2026, 5, 1 + day, 13, 30) / 1000;
    for (let i = 0; i < 66; i++) {
      const phase = i % 20;
      const price = 5000 + (phase < 10 ? -4 * phase : -40 + 4 * (phase - 10));
      wave.push({
        time: dayOpen + i * 300,
        open: price,
        high: price + 2,
        low: price - 2,
        close: price,
        volume: 100,
      });
    }
  }

  it("produces a gross book that is never worse per trade than net, on matched trades", async () => {
    const report = await runGrossNet(req(wave), executeRun, LEGACY_MODEL);
    expect(report.net.trades.length).toBeGreaterThan(0);
    const m = report.divergence.matchedBeforeDivergence;
    expect(m).toBeGreaterThan(0);
    for (let i = 0; i < m; i++) {
      expect(report.gross.trades[i].pnl).toBeGreaterThan(report.net.trades[i].pnl - 1e-9);
    }
  });

  /* With slippage OFF, commission is the whole story: it is a flat dollar
     subtraction that never touches a price, so the matched prefix reconciles
     to the cent. */
  it("reconciles exactly against commission when slippage is off", async () => {
    const noSlip = req(wave, { execution: { ...EXECUTION, slippage: 0 } });
    const report = await runGrossNet(noSlip, executeRun, LEGACY_MODEL);
    const d = report.divergence;
    expect(d.matchedBeforeDivergence).toBeGreaterThan(0);
    expect(d.reconciles).toBe(true);
    expect(d.geometryEffect).toBeCloseTo(0, 6);
  });

  /* With slippage ON it does NOT reconcile against commission, and that is a
     real property of the model rather than a bug: moving the entry price also
     moves |entry − stop|, which moves an rMultiple target proportionally. The
     slipped book travels further to its target and books more gross points,
     so the true drag is smaller than the nominal slippage charge. Pinned here
     because it is exactly the kind of thing that would otherwise be quietly
     mis-labelled as "slippage cost" in a report. */
  it("attributes the rest to geometry, not to a slippage dollar figure", async () => {
    const report = await runGrossNet(req(wave), executeRun, LEGACY_MODEL);
    const d = report.divergence;
    expect(d.matchedBeforeDivergence).toBeGreaterThan(0);
    expect(d.reconciles).toBe(false);
    expect(d.geometryEffect).not.toBeCloseTo(0, 2);
    // The measured drag is real, but strictly smaller than the nominal charge.
    expect(-d.deltaMatched).toBeGreaterThan(0);
    expect(-d.deltaMatched).toBeLessThan(d.frictionOnMatched);
  });

  /* The zero-cost model against itself: both books are the same run, so the
     gap must be exactly nothing. Catches a runner that silently applies costs
     it was told not to. */
  it("shows no gap at all when the net run is already cost-free", async () => {
    const free = req(wave, { execution: { ...EXECUTION, cost: 0, slippage: 0 } });
    const report = await runGrossNet(free, executeRun, ZERO_COST_MODEL);
    expect(report.divergence.firstDivergenceTime).toBeNull();
    expect(report.grossNetTotal).toBeCloseTo(report.netNetTotal, 9);
    expect(report.divergence.frictionOnMatched).toBe(0);
  });

  it("reports both totals and both per-trade expectancies", async () => {
    const report = await runGrossNet(req(wave), executeRun, LEGACY_MODEL);
    expect(Number.isFinite(report.grossNetTotal)).toBe(true);
    expect(Number.isFinite(report.netNetTotal)).toBe(true);
    expect(report.netPerTrade).toBeCloseTo(report.netNetTotal / report.net.trades.length, 9);
  });
});
