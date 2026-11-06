import { describe, expect, it } from "vitest";
import { marketContext, sessionClock, type JudgeBar } from "@/lib/ai-judge/features";
import { judgeUserMessage, parseJudgeVerdict, type JudgeIdea } from "@/lib/ai-judge/prompt";

// Friday 2026-11-06, New York on EST (UTC-5): 10:10 ET = 15:10 UTC.
const T = (iso: string) => Date.parse(iso) / 1000;
const CUTOFF = T("2026-11-06T15:10:00Z");

/** 5-minute bars from Thursday 12:00 UTC to Friday 15:05 UTC (bar open times),
    price rising 0.25 a bar from 7000. */
function bars(until = T("2026-11-06T15:05:00Z")): JudgeBar[] {
  const out: JudgeBar[] = [];
  let p = 7000;
  for (let t = T("2026-11-05T12:00:00Z"); t <= until; t += 300) {
    out.push({ time: t, open: p, high: p + 1, low: p - 1, close: p + 0.25 });
    p += 0.25;
  }
  return out;
}

describe("AI second opinion: market context is point in time", () => {
  it("ignores every bar that had not ended by the cutoff, whatever the caller passes", () => {
    const now = marketContext({ bars: bars(), cutoffSec: CUTOFF, entry: 7100, stop: 7110 });
    const withFuture = marketContext({ bars: [...bars(T("2026-11-06T20:00:00Z")), { time: CUTOFF - 60, open: 1, high: 99999, low: 1, close: 99999 }], cutoffSec: CUTOFF, entry: 7100, stop: 7110 });
    expect(withFuture).toEqual(now);
    expect(now.lastBarEnd).toBe(CUTOFF);
  });

  it("measures today from the Globex reopen and the previous session's close", () => {
    const c = marketContext({ bars: bars(), cutoffSec: CUTOFF, entry: 7100, stop: 7110 });
    const all = bars();
    const todayFirst = all.find((b) => b.time >= T("2026-11-05T23:00:00Z"))!; // Thu 18:00 ET belongs to Friday
    const priorClose = all.filter((b) => b.time < T("2026-11-05T23:00:00Z")).at(-1)!.close;
    const last = all.at(-1)!.close;
    expect(c.changeTodayPct).toBeCloseTo(((last - todayFirst.open) / todayFirst.open) * 100, 2);
    expect(c.priorCloseDistancePct).toBeCloseTo(((last - priorClose) / priorClose) * 100, 2);
    expect(c.last1hPct).toBeGreaterThan(0);
    expect(c.trend1h).toBe("up");
    expect(c.dayRangePosition).toBeGreaterThan(0.9);
    expect(c.rsi14).toBe(100);
    expect(c.atr14Points).toBeGreaterThan(0);
    expect(c.stopDistanceAtr).toBeCloseTo(10 / c.atr14Points!, 1);
  });

  it("does not invent a price across a gap", () => {
    // No bars opened 13:00-14:45 UTC: an hour ago falls in the gap, 15 minutes ago does not.
    const gappy = bars().filter((b) => b.time < T("2026-11-06T13:00:00Z") || b.time >= T("2026-11-06T14:50:00Z"));
    const c = marketContext({ bars: gappy, cutoffSec: CUTOFF, entry: 7100, stop: 7110 });
    expect(c.last1hPct).toBeNull();
    expect(c.last15mPct).not.toBeNull();
  });

  it("returns an empty context without bars", () => {
    expect(marketContext({ bars: [], cutoffSec: CUTOFF, entry: 1, stop: 2 }).barsUsed).toBe(0);
  });

  it("knows the New York time and the minutes left before the 15:25 flat", () => {
    expect(sessionClock(CUTOFF)).toEqual({ newYork: "Fri 10:10", minutesUntilFlat: 315 });
  });
});

describe("AI second opinion: prompt and answer", () => {
  const idea: JudgeIdea = {
    symbol: "MES", side: "SHORT", strategy: "rsi-reversion", paused: true, entry: 7437.75, stop: 7460.398386884567, target: 7403.77741967315,
    rewardRisk: 1.5, riskUsdOneContract: 111.89193442283559, newYorkTime: "Fri 10:10", minutesUntilFlat: 315,
    features: { regime: "range-high-vol", vixBucket: "high", atrPct: 0.1796, vwapAtr: 4.6078 },
  };

  it("describes the idea in plain words and never shows what the bot did or the result", () => {
    const msg = judgeUserMessage(idea, marketContext({ bars: bars(), cutoffSec: CUTOFF, entry: idea.entry, stop: idea.stop }));
    const parsed = JSON.parse(msg);
    expect(parsed.idea).toBe("sell: profits if the price falls");
    expect(parsed.method).toMatch(/^RSI reversion: /);
    expect(parsed.method_paused_after_losing_streak).toBe(true);
    expect(parsed.stop).toBe(7460.4);
    expect(parsed.risk_usd_one_contract).toBe(111.89);
    expect(msg).not.toMatch(/"(action|taken|net|result|pnl|outcome)"/i);
  });

  it("parses usable answers and refuses unusable ones", () => {
    expect(parseJudgeVerdict('{"decision":"skip","confidence":85,"reason":"Selling into a strong uptrend."}')).toEqual({ decision: "skip", confidence: 85, reason: "Selling into a strong uptrend." });
    expect(parseJudgeVerdict('```json\n{"decision":"TAKE","confidence":"70","reason":" ok ","extra":1}\n```')).toEqual({ decision: "take", confidence: 70, reason: "ok" });
    expect(parseJudgeVerdict('{"decision":"take","confidence":64.6,"reason":"x"}')?.confidence).toBe(65);
    expect(parseJudgeVerdict('{"decision":"maybe","confidence":50,"reason":"x"}')).toBeNull();
    expect(parseJudgeVerdict('{"decision":"take","confidence":150,"reason":"x"}')).toBeNull();
    expect(parseJudgeVerdict('{"decision":"take","confidence":50}')).toBeNull();
    expect(parseJudgeVerdict("I would skip this one.")).toBeNull();
    expect(parseJudgeVerdict(`{"decision":"skip","confidence":10,"reason":"${"long ".repeat(400)}"}`)?.reason.length).toBe(1200);
  });
});
