import { describe, expect, it } from "vitest";
import {
  STALE_BAR_AGE_MIN,
  assessStaleness,
  barAgeMinutes,
  lastBarBySymbol,
  staleAtSignal,
  staleReason,
} from "@/lib/signals/freshness";
import { activeOnly, staleExcluded, stats } from "../scripts/engine/digest-stats";
import { buildModelRows } from "../scripts/engine/train-set";

/* Item 2.4. This week's digest reported a worst bar age of 104 minutes against
   a nominal 10–15 minute Yahoo delay: the feed stalled and the engine ran
   anyway. Such a run still records its signals — deleting them would hide the
   outage — but every row is flagged stale_data and excluded from headline
   stats, Telegram and the model's training set, exactly like `suppressed`. */

const T0 = Math.floor(Date.UTC(2026, 6, 24, 18, 0, 0) / 1000); // 14:00 ET
const bars = (lastAgeMin: number, nowSec: number) => [
  { time: nowSec - (lastAgeMin + 10) * 60 },
  { time: nowSec - lastAgeMin * 60 },
];

describe("barAgeMinutes", () => {
  it("measures the newest bar, not the oldest", () => {
    expect(barAgeMinutes(bars(7, T0), T0)).toBe(7);
  });
  it("is 0 for an empty series and never negative", () => {
    expect(barAgeMinutes([], T0)).toBe(0);
    expect(barAgeMinutes([{ time: T0 + 600 }], T0)).toBe(0);
  });
});

describe("assessStaleness", () => {
  it("passes a fresh feed at the nominal delay", () => {
    const v = assessStaleness({ MES: bars(12, T0), MNQ: bars(14, T0) }, T0);
    expect(v.stale).toBe(false);
    expect(v.worstAgeMin).toBe(14);
    expect(v.note).toBeNull();
  });

  it("flags the 104-minute stall that motivated the gate", () => {
    const v = assessStaleness({ MES: bars(104, T0), MNQ: bars(9, T0) }, T0);
    expect(v.stale).toBe(true);
    expect(v.worstAgeMin).toBe(104);
    expect(v.thresholdMin).toBe(STALE_BAR_AGE_MIN);
    expect(v.note).toContain("104m");
    expect(v.note).toContain(String(STALE_BAR_AGE_MIN));
  });

  it("takes the WORST symbol, so one stalled feed taints the run", () => {
    expect(assessStaleness({ MES: bars(2, T0), MNQ: bars(90, T0) }, T0).stale).toBe(true);
  });

  it("treats the threshold as inclusive-fresh", () => {
    expect(assessStaleness({ MES: bars(30, T0) }, T0, 30).stale).toBe(false);
    expect(assessStaleness({ MES: bars(31, T0) }, T0, 30).stale).toBe(true);
  });

  it("explains itself for the drawer", () => {
    expect(staleReason(104, 30)).toBe("computed on bars 104m old — over the 30m limit");
  });
});

describe("stale rows get the `suppressed` treatment", () => {
  const row = (over: Partial<Parameters<typeof stats>[0][number]> = {}) => ({
    pnl_usd: 100,
    fill_confidence: "clean" as string | null,
    suppressed: false,
    stale_data: false,
    ...over,
  });

  it("is excluded from headline stats", () => {
    const rows = [row(), row({ pnl_usd: -50 }), row({ pnl_usd: 900, stale_data: true })];
    const headline = stats(activeOnly(rows));
    expect(headline.closed).toBe(2);
    expect(headline.net).toBe(50); // the +900 stale row is not counted
  });

  it("is reported on its own line rather than dropped", () => {
    const rows = [row(), row({ pnl_usd: 900, stale_data: true }), row({ pnl_usd: -10, stale_data: true })];
    const s = staleExcluded(rows);
    expect(s.total).toBe(2);
    expect(s.closed).toBe(2);
    expect(s.net).toBe(890);
  });

  it("is excluded independently of the breaker flag", () => {
    const rows = [row({ suppressed: true }), row({ stale_data: true }), row()];
    expect(activeOnly(rows)).toHaveLength(1);
  });

  it("never enters the model's training set", () => {
    const real = [
      { tier: "B" as const, symbol: "MES", dedupe_key: "B:rsi:MES:1", signal_ts: "2026-07-24T14:00:00.000Z", regime: null, vix_bucket: null, score: null, rr: 1.5, pnl_usd: 100, fill_confidence: "clean", stale_data: false },
      { tier: "B" as const, symbol: "MES", dedupe_key: "B:rsi:MES:2", signal_ts: "2026-07-24T15:00:00.000Z", regime: null, vix_bucket: null, score: null, rr: 1.5, pnl_usd: 900, fill_confidence: "clean", stale_data: true },
    ];
    const shadow = [
      { strategy: "orb", symbol: "MNQ", signal_ts: "2026-07-24T16:00:00.000Z", regime: null, vix_bucket: null, score: null, rr: 1, pnl_usd: 5, fill_confidence: "clean", stale_data: true },
    ];
    const built = buildModelRows(real, shadow);
    expect(built).toHaveLength(1);
    expect(built[0].pnl_usd).toBe(100);
  });

  it("drops a stale real row BEFORE dedup, so a clean shadow twin survives", () => {
    const sameTs = "2026-07-24T14:00:00.000Z";
    const real = [
      { tier: "B" as const, symbol: "MES", dedupe_key: "B:orb:MES:1", signal_ts: sameTs, regime: null, vix_bucket: null, score: null, rr: 1, pnl_usd: 50, fill_confidence: "clean", stale_data: true },
    ];
    const shadow = [
      { strategy: "orb", symbol: "MES", signal_ts: sameTs, regime: null, vix_bucket: null, score: null, rr: 1, pnl_usd: 50, fill_confidence: "clean", stale_data: false },
    ];
    const built = buildModelRows(real, shadow);
    expect(built).toHaveLength(1);
    expect(built[0].tier).toBeNull(); // the shadow row, not the dropped real one
  });
});

/* The bug the first live run caught: flagging by RUN staleness instead of per
   row. Every engine pass recomputes the trailing 7 days, so a Saturday run (bars
   652 minutes old, market shut Friday) flagged all nine of Friday's rows —
   which, repeated, drains every headline stat to zero. */
describe("staleAtSignal — per row, not per run", () => {
  const FRI_CLOSE = Math.floor(Date.UTC(2026, 6, 24, 20, 55, 0) / 1000);

  it("does NOT flag a weekend recompute of well-observed Friday rows", () => {
    // Friday 19:20 UTC entry, bars run to Friday 20:55 → 95 min of history after.
    expect(staleAtSignal(FRI_CLOSE - 95 * 60, FRI_CLOSE)).toBe(false);
    // Even hours later on Saturday, the answer is the same — no wall clock.
    expect(staleAtSignal(FRI_CLOSE - 6 * 3600, FRI_CLOSE)).toBe(false);
  });

  it("DOES flag a row at the blind edge of the data", () => {
    // The stall case: the newest bar is the entry bar, so nothing after it was
    // seen and its fill audit cannot be judged.
    expect(staleAtSignal(FRI_CLOSE, FRI_CLOSE)).toBe(true);
    expect(staleAtSignal(FRI_CLOSE - 25 * 60, FRI_CLOSE)).toBe(true);
  });

  it("treats the threshold as inclusive-fresh, matching the run-level gate", () => {
    expect(staleAtSignal(FRI_CLOSE - 30 * 60, FRI_CLOSE, 30)).toBe(false);
    expect(staleAtSignal(FRI_CLOSE - 29 * 60, FRI_CLOSE, 30)).toBe(true);
  });

  it("stays out of it when a symbol has no bars at all", () => {
    expect(staleAtSignal(FRI_CLOSE, null)).toBe(false);
  });

  it("reads the newest bar per symbol", () => {
    const last = lastBarBySymbol({ MES: [{ time: 10 }, { time: 40 }], MNQ: [], MISSING: [] });
    expect(last.MES).toBe(40);
    expect(last.MNQ).toBeNull();
  });

  it("self-corrects: the same row is clean once the bars catch up", () => {
    const entry = FRI_CLOSE;
    expect(staleAtSignal(entry, entry)).toBe(true); // during the stall
    expect(staleAtSignal(entry, entry + 60 * 60)).toBe(false); // an hour of bars later
  });
});
