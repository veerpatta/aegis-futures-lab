import { describe, expect, it } from "vitest";
import { stepTrial, perContractRisk, positionValue, type TrialAccount, type TrialCosts, type TrialIdea, type TrialPosition, type TrialStepInput } from "@/lib/trial/engine";
import { TRIAL_RISK, sizeTrialTrade } from "@/lib/trial/policy";
import { PAPER_RISK } from "@/lib/paper/policy";
import { EXECUTION } from "@/scripts/engine/tiers";
import type { Bar } from "@/lib/types";

const sec = (iso: string) => Date.parse(iso) / 1000;
// Monday 2026-10-05, EDT: 10:00 ET = 14:00Z.
const et = (hhmm: string) => sec(`2026-10-05T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);

const costs: TrialCosts = { pointValue: { MES: 5, MNQ: 2 }, costPerContract: 2.4, slip: () => 0.25 };

const account = (over: Partial<TrialAccount> = {}): TrialAccount => ({
  round: 1, startedAt: et("09:00"), equity: 10000, peak: 10000, dayKey: "", dayStartEquity: 10000,
  dailyPnl: 0, openRisk: 0, locked: false, lockedAt: null, lastEventTs: null, ...over,
});

const idea = (over: Partial<TrialIdea> & { key: string }): TrialIdea => ({
  id: 1, symbol: "MES", side: "LONG", entry: 6000, stop: 5970, target: 6060, qty: 1,
  signalTs: et("10:00"), exitTs: null, exitPrice: null, status: "triggered", visible: true, ...over,
});

function bars(from: string, to: string, price = 6000, over: Record<number, Partial<Bar>> = {}): Bar[] {
  const out: Bar[] = [];
  for (let t = et(from); t <= et(to); t += 300) out.push({ time: t, open: price, high: price + 1, low: price - 1, close: price, ...over[t] });
  return out;
}

function run(input: Partial<TrialStepInput> & { ideas: TrialIdea[] }) {
  return stepTrial({ account: account(), open: [], realized: 0, decided: new Set(), bars: {}, nowSec: et("15:59"), costs, ...input });
}

describe("trial account limits", () => {
  it("shares the practice account's protective limits and the methods' own size cap", () => {
    expect(TRIAL_RISK.capital).toBe(PAPER_RISK.capital);
    expect(TRIAL_RISK.dailyLoss).toBe(PAPER_RISK.dailyLoss);
    expect(TRIAL_RISK.maxDrawdown).toBe(PAPER_RISK.maxDrawdown);
    expect(TRIAL_RISK.perTrade).toBe(EXECUTION.maxRisk);
  });

  it("takes the idea's own size and trims it to the room left", () => {
    const state = { equity: 10000, peak: 10000, dailyPnl: 0, openRisk: 0, locked: false };
    expect(sizeTrialTrade(state, 50, 3)).toEqual({ qty: 3, reason: null });
    expect(sizeTrialTrade(state, 50, 5)).toEqual({ qty: 3, reason: null });
    expect(sizeTrialTrade({ ...state, openRisk: 300 }, 50, 1)).toEqual({ qty: 0, reason: "open-risk" });
    expect(sizeTrialTrade({ ...state, dailyPnl: -380 }, 50, 1)).toEqual({ qty: 0, reason: "daily-loss" });
    expect(sizeTrialTrade({ ...state, dailyPnl: -400 }, 50, 1)).toEqual({ qty: 0, reason: "daily-loss" });
    expect(sizeTrialTrade({ ...state, peak: 12000 }, 50, 1)).toEqual({ qty: 0, reason: "locked" });
    expect(sizeTrialTrade(state, 170, 1)).toEqual({ qty: 0, reason: "risk-budget" });
    expect(sizeTrialTrade(state, NaN, 1)).toEqual({ qty: 0, reason: "no-risk" });
  });
});

describe("trial account copies ideas", () => {
  it("mirrors the idea's exit to the cent (the Oct 5 Nasdaq stop-out)", () => {
    const i = idea({ key: "A:x:MNQ:1", symbol: "MNQ", side: "SHORT", entry: 31166.88, stop: 31218.55, target: 31089.37,
      exitTs: et("10:20"), exitPrice: 31218.8, status: "hit_stop" });
    expect(perContractRisk(i, i.signalTs, costs)).toBeCloseTo(106.24, 6);
    const r = run({ ideas: [i], bars: { MNQ: bars("10:00", "10:30", 31170) } });
    expect(r.decisions).toEqual([{ round: 1, signalKey: i.key, taken: true, qty: 1, reason: "taken" }]);
    const p = r.changed[0];
    expect(p.pnl).toBe(-106.24);
    expect(p.exitReason).toBe("idea");
    expect(p.closedAt).toBe(et("10:20"));
    expect(r.account.equity).toBe(10000 - 106.24);
  });

  it("is idempotent: a second pass over the same ideas changes nothing", () => {
    const ideas = [idea({ key: "k1", exitTs: et("11:00"), exitPrice: 6060, status: "hit_target" }), idea({ key: "k2", signalTs: et("12:00") })];
    const b = { MES: bars("09:00", "13:00") };
    const first = run({ ideas, bars: b, nowSec: et("13:05") });
    const open = first.changed.filter((p) => p.closedAt === null);
    const realized = first.changed.filter((p) => p.closedAt !== null).reduce((a, p) => a + p.pnl!, 0);
    const second = stepTrial({ account: first.account, open, realized, decided: new Set(first.decisions.map((d) => d.signalKey)),
      ideas, bars: b, nowSec: et("13:05"), costs });
    expect(second.decisions).toEqual([]);
    expect(second.opened).toEqual([]);
    expect(second.account.equity).toBe(first.account.equity);
  });

  it("counts open risk at the moment of entry, using only exits before it", () => {
    // Each MES idea risks (30 + 0.25) × $5 + $2.40 = $153.65; two fit inside $320.
    const ideas = [
      idea({ key: "a", signalTs: et("10:00"), exitTs: et("10:30"), exitPrice: 6010, status: "closed_win" }),
      idea({ key: "b", signalTs: et("10:10") }),
      idea({ key: "c", signalTs: et("10:20") }),
      idea({ key: "d", signalTs: et("10:40") }),
    ];
    const r = run({ ideas, bars: { MES: bars("10:00", "11:00") }, nowSec: et("11:05") });
    expect(Object.fromEntries(r.decisions.map((d) => [d.signalKey, d.reason]))).toEqual({ a: "taken", b: "taken", c: "open-risk", d: "taken" });
  });

  it("stops taking ideas for the day after the daily loss limit", () => {
    const loss = (key: string, at: string, out: string) => idea({ key, signalTs: et(at), exitTs: et(out), exitPrice: 5969.75, status: "hit_stop" });
    const ideas = [loss("1", "10:00", "10:05"), loss("2", "10:30", "10:35"), loss("3", "11:00", "11:05")];
    const r = run({ ideas, bars: { MES: bars("10:00", "11:30") }, nowSec: et("11:35") });
    expect(r.decisions.map((d) => d.reason)).toEqual(["taken", "taken", "daily-loss"]);
    expect(r.account.dailyPnl).toBeCloseTo(-307.3, 2);
  });

  it("locks the account at the drawdown limit and takes nothing after", () => {
    const r = run({ ideas: [idea({ key: "x", signalTs: et("10:05") })], account: account({ peak: 12000 }), bars: { MES: bars("10:00", "10:30") }, nowSec: et("10:35") });
    expect(r.decisions[0].reason).toBe("locked");
    expect(r.account.locked).toBe(true);
  });

  it("manages a taken idea on bars once it leaves the Ideas tab", () => {
    const i = idea({ key: "gone", side: "LONG", entry: 6000, stop: 5990 });
    const first = run({ ideas: [i], bars: { MES: bars("10:00", "10:10") }, nowSec: et("10:15") });
    const open = first.changed.filter((p) => p.closedAt === null);
    const b = bars("10:00", "10:30", 6000, { [et("10:20")]: { open: 5995, low: 5985, close: 5986 } });
    const second = stepTrial({ account: first.account, open, realized: 0, decided: new Set(["gone"]),
      ideas: [{ ...i, visible: false }], bars: { MES: b }, nowSec: et("10:35"), costs });
    const p = second.changed.find((x) => x.closedAt !== null)!;
    expect(p.exitReason).toBe("stop");
    expect(p.exitPrice).toBe(5990 - 0.25);
    expect(p.pnl).toBe(positionValue(p, 5989.75, costs));
  });

  it("flattens a position whose idea is still open after the session's flatten time", () => {
    const r = run({ ideas: [idea({ key: "late-row", signalTs: et("15:00") })], bars: { MES: bars("15:00", "15:40") }, nowSec: et("15:45") });
    const p = r.changed[0];
    expect(p.exitReason).toBe("session");
    expect(p.closedAt).toBe(et("15:30"));
  });

  it("still decides an idea it first sees after moving past its time", () => {
    const r = run({ ideas: [idea({ key: "late", signalTs: et("10:00") })], account: account({ lastEventTs: et("10:30"), dayKey: "2026-10-05" }),
      bars: { MES: bars("10:00", "10:40") }, nowSec: et("10:45") });
    expect(r.decisions).toHaveLength(1);
    expect(r.opened[0].openedAt).toBe(et("10:00"));
  });

  it("ignores ideas before the round, hidden ideas, and ideas that never filled", () => {
    const ideas = [
      idea({ key: "before", signalTs: et("08:00") }),
      idea({ key: "hidden", visible: false }),
      idea({ key: "pending", status: "pending" }),
      idea({ key: "cancelled", status: "cancelled" }),
    ];
    expect(run({ ideas }).decisions).toEqual([]);
  });

  it("never marks an open position past a closed one's bookkeeping", () => {
    const p: TrialPosition = { id: "1:k", round: 1, signalKey: "k", signalId: 1, symbol: "MES", side: "LONG", qty: 1, entry: 6000, stop: 5970,
      target: null, risk: 153.65, mark: 6000, openedAt: et("10:00"), lastMarkTs: et("10:30"), closedAt: null, exitPrice: null, pnl: null, exitReason: null };
    const r = run({ ideas: [idea({ key: "k" })], open: [p], decided: new Set(["k"]), account: account({ lastEventTs: et("10:30"), dayKey: "2026-10-05" }),
      bars: { MES: bars("10:00", "10:40", 6004) }, nowSec: et("10:45") });
    expect(r.changed[0].mark).toBe(6004);
    expect(r.changed[0].lastMarkTs).toBe(et("10:45"));
  });
});
