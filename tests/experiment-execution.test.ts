import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { EXP_RISK, FRICTION, COMMISSION_RT, perContractRisk, sizeExperimentTrade, standaloneQty } from "@/lib/experiment/policy";
import { fillEntry, flattenAtSession, forceClose, newSimTrade, simulate, stepOpen } from "@/lib/experiment/execution";
import { PAPER_RISK } from "@/lib/paper/policy";
import { EXECUTION } from "@/scripts/engine/tiers";
import type { SimTrade } from "@/lib/experiment/types";

const sec = (iso: string) => Date.parse(iso) / 1000;
// Wednesday 2026-10-07, EDT: ET = UTC − 4.
const et = (hhmm: string, day = "2026-10-07") => sec(`${day}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);
const bar = (hhmm: string, o: number, h: number, l: number, c: number, day?: string): Bar => ({ time: et(hhmm, day), open: o, high: h, low: l, close: c });
const trade = (over: Partial<SimTrade> = {}): SimTrade =>
  ({ ...newSimTrade({ symbol: "MES", side: "LONG", qty: 1, stop: 5990, target: 6020, decidedAt: et("11:02"), sessionKey: "2026-10-07" }), ...over });

describe("experiment limits", () => {
  it("are the practice account's own numbers and the live cost model", () => {
    expect(EXP_RISK.capital).toBe(PAPER_RISK.capital);
    expect(EXP_RISK.riskPerTrade).toBe(PAPER_RISK.riskPerTrade);
    expect(EXP_RISK.totalOpenRisk).toBe(PAPER_RISK.totalOpenRisk);
    expect(EXP_RISK.dailyLoss).toBe(PAPER_RISK.dailyLoss);
    expect(EXP_RISK.maxDrawdown).toBe(PAPER_RISK.maxDrawdown);
    expect(EXP_RISK.minStopPoints).toBe(EXECUTION.minStopPoints);
    expect(COMMISSION_RT).toBe(EXECUTION.cost);
    expect({ ...FRICTION, bySymbol: { MES: FRICTION.bySymbol.MES, MNQ: FRICTION.bySymbol.MNQ } })
      .toEqual({ ...EXECUTION.friction!, bySymbol: { MES: EXECUTION.friction!.bySymbol.MES, MNQ: EXECUTION.friction!.bySymbol.MNQ } });
  });

  it("sizes in whole contracts and never grows after losses", () => {
    const base = { equity: 10000, peak: 10000, dailyPnl: 0, openRisk: 0, locked: false, dayHalted: false };
    expect(sizeExperimentTrade(base, 40)).toEqual({ qty: 2, reason: null });
    expect(sizeExperimentTrade({ ...base, equity: 9700, dailyPnl: -300 }, 40).qty).toBeLessThanOrEqual(2);
    expect(sizeExperimentTrade(base, 101)).toEqual({ qty: 0, reason: "risk-budget" });
    expect(sizeExperimentTrade({ ...base, openRisk: 180 }, 40)).toEqual({ qty: 0, reason: "open-risk" });
    expect(sizeExperimentTrade({ ...base, dayHalted: true }, 40).reason).toBe("daily-loss");
    expect(sizeExperimentTrade({ ...base, locked: true }, 40).reason).toBe("locked");
    expect(sizeExperimentTrade({ ...base, equity: 8000 }, 40).reason).toBe("locked");
    expect(sizeExperimentTrade(base, NaN).reason).toBe("no-risk");
    for (let loss = 0; loss < 400; loss += 50)
      expect(sizeExperimentTrade({ ...base, equity: 10000 - loss, dailyPnl: -loss }, 30).qty).toBeLessThanOrEqual(sizeExperimentTrade(base, 30).qty);
    expect(standaloneQty(perContractRisk("MES", 6000, 5990, et("11:00")))).toBe(1);
  });
});

describe("simulated fills", () => {
  it("never fills on a bar that began before the decision", () => {
    const t = trade();
    expect(fillEntry(t, bar("11:00", 6000, 6001, 5999, 6000))).toBe(t);
    const f = fillEntry(t, bar("11:05", 6000, 6001, 5999, 6000));
    expect(f.status).toBe("open");
    expect(f.fillTs).toBe(et("11:05"));
    expect(f.fillPrice).toBe(6000.25); // open + one tick against us
  });

  it("cancels when the open is through the stop or target, too tight, or after the flatten time", () => {
    expect(fillEntry(trade(), bar("11:05", 5989, 5995, 5985, 5990)).cancelReason).toBe("stop-breached");
    expect(fillEntry(trade(), bar("11:05", 6021, 6022, 6019, 6020)).cancelReason).toBe("target-passed");
    expect(fillEntry(trade({ stop: 5998.5 }), bar("11:05", 6000, 6001, 5999, 6000)).cancelReason).toBe("stop-too-small");
    expect(fillEntry(trade({ decidedAt: et("15:21") }), bar("15:25", 6000, 6001, 5999, 6000)).cancelReason).toBe("session-over");
  });

  it("trims to the risk cap at the real fill", () => {
    const f = fillEntry(trade({ qty: 3, stop: 5985 }), bar("11:05", 6000, 6001, 5999, 6000), { maxRisk: 100 });
    expect(f.qty).toBe(1);
    expect(f.risk).toBeLessThanOrEqual(100);
  });
});

describe("simulated exits", () => {
  const open = () => fillEntry(trade(), bar("11:05", 6000, 6001, 5999, 6000));

  it("takes the stop when one bar touches both stop and target, and says so", () => {
    const x = stepOpen(open(), bar("11:10", 6000, 6025, 5985, 6010));
    expect(x.exitReason).toBe("stop");
    expect(x.ambiguous).toBe(true);
    expect(x.exitPrice).toBe(5989.75);
  });

  it("fills a gap through the stop at the open, not at the stop", () => {
    const x = stepOpen(open(), bar("11:10", 5980, 5982, 5975, 5978));
    expect(x.exitReason).toBe("stop");
    expect(x.exitPrice).toBe(5979.75);
    expect(x.net).toBeLessThan(-(10 * 5));
  });

  it("fills targets at the target and books costs both ways", () => {
    const x = stepOpen(open(), bar("11:10", 6005, 6021, 6004, 6018));
    expect(x.exitReason).toBe("target");
    expect(x.exitPrice).toBe(6020);
    expect(x.gross).toBe(Math.round((6020 - 6000.25) * 5 * 100) / 100);
    expect(x.fees).toBe(2.4);
    expect(x.net).toBe(Math.round((x.gross! - 2.4) * 100) / 100);
  });

  it("is flat by 15:25 New York time, and earlier on an early-close day", () => {
    let t = open();
    for (const b of [bar("15:15", 6001, 6002, 6000, 6001), bar("15:20", 6001, 6002, 6000, 6002)]) t = stepOpen(t, b);
    expect(t.exitReason).toBe("session");
    expect(t.exitTs).toBe(et("15:25"));
    expect(flattenAtSession("2026-11-27")).toBeLessThan(flattenAtSession("2026-11-30")); // day after Thanksgiving closes early
  });

  it("closes at the next open when the flatten bar never arrived", () => {
    const t = stepOpen(open(), bar("15:30", 6003, 6004, 6002, 6003));
    expect(t.exitReason).toBe("session-late");
  });

  it("never invents an exit without a bar", () => {
    const t = simulate(open(), []);
    expect(t.status).toBe("open");
    expect(forceClose(t, et("12:00"), "daily-loss").exitReason).toBe("daily-loss");
  });
});
