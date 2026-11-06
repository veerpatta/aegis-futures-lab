import { describe, expect, it } from "vitest";
import { ago, quietReasons, timerStatus } from "@/lib/plain/timer";
import type { BotPolicyRow, EngineClockRow } from "@/lib/neon/client";
import type { ExpOverview } from "@/lib/experiment/view";

const NOW = Date.parse("2026-11-06T13:30:00Z") / 1000;
const iso = (minutesAgo: number) => new Date((NOW - minutesAgo * 60) * 1000).toISOString();
const clock = (outcome: EngineClockRow["outcome"], minutesAgo = 9, http_status: number | null = null): EngineClockRow =>
  ({ fired_at: iso(minutesAgo), route: "engine", outcome, http_status, message: null });

describe("timer status: names the cause and the fix", () => {
  it("is on time when the clock started the engine and the engine ran", () => {
    expect(timerStatus({ lastRunAt: iso(8), clock: clock("dispatched"), nowSec: NOW, asleep: false }))
      .toMatchObject({ tone: "good", title: "On time", fix: false });
  });

  it("explains the 2 November GitHub delay with the one-time fix", () => {
    // The real state on 2026-11-06: last engine run 07:53 UTC, no clock key.
    const s = timerStatus({ lastRunAt: "2026-11-06T07:54:33Z", clock: clock("not-configured"), nowSec: NOW, asleep: false });
    expect(s).toMatchObject({ tone: "warn", title: "Running late", fix: true });
    expect(s.detail).toBe("Prices were last checked 6 h ago because GitHub's free timer is hours late. Fix it once: turn on the 15-minute timer (free, 3 minutes).");
    expect(timerStatus({ lastRunAt: iso(300), clock: null, nowSec: NOW, asleep: false }).title).toBe("Running late");
  });

  it("is amber, never red, for lateness; red only for a refused key", () => {
    expect(timerStatus({ lastRunAt: iso(300), clock: clock("dispatched", 5), nowSec: NOW, asleep: false })).toMatchObject({ tone: "warn", title: "Waiting for GitHub", fix: false });
    expect(timerStatus({ lastRunAt: iso(300), clock: clock("failed", 5), nowSec: NOW, asleep: false }).tone).toBe("warn");
    expect(timerStatus({ lastRunAt: iso(300), clock: clock("dispatched", 200), nowSec: NOW, asleep: false })).toMatchObject({ tone: "warn", title: "Timer is silent", fix: true });
    expect(timerStatus({ lastRunAt: iso(300), clock: clock("rejected", 5, 401), nowSec: NOW, asleep: false })).toMatchObject({ tone: "bad", title: "Timer key refused", fix: true });
  });

  it("suggests the setup even when GitHub happened to run on time", () => {
    expect(timerStatus({ lastRunAt: iso(12), clock: clock("not-configured"), nowSec: NOW, asleep: false })).toMatchObject({ tone: "good", title: "Checked 12 min ago", fix: true });
  });

  it("says nothing alarming while the market is closed", () => {
    expect(timerStatus({ lastRunAt: iso(3000), clock: null, nowSec: NOW, asleep: true })).toMatchObject({ tone: "info", title: "Market closed", fix: false });
  });

  it("formats ages plainly", () => {
    expect([ago(0.2), ago(12), ago(95), ago(60 * 40), ago(Infinity)]).toEqual(["1 min", "12 min", "2 h", "2 days", "a long time"]);
  });
});

describe("why it has been quiet: only saved reasons", () => {
  const overview = (decisions: ExpOverview["recent_decisions"], risk: ExpOverview["risk"] = null) => ({ recent_decisions: decisions, risk } as unknown as ExpOverview);
  const skip = (reason: string, daysAgo: number, id = Math.random()) => ({ id, opportunity_key: `k${id}`, action: "skip" as const, reason, qty: 0, decided_at: iso(daysAgo * 1440), position_status: null, net: null });
  const policy = (stream: string, action: BotPolicyRow["action"], daysAgo: number): BotPolicyRow =>
    ({ id: Math.random(), changed_at: iso(daysAgo * 1440), actor: "breaker", stream, action, reason: null, metrics: null });

  it("counts this week's skip reasons, most frequent first", () => {
    const lines = quietReasons(overview([skip("risk-budget", 2), skip("risk-budget", 3), skip("late-source", 1), skip("risk-budget", 20)]), [], NOW);
    expect(lines[0]).toBe("2 ideas skipped this week: one contract would risk more than $100.");
    expect(lines[1]).toBe("1 idea skipped this week: this idea was published after that market period had already been processed.");
  });

  it("names paused methods and whether the bot still sees their ideas", () => {
    const pol = [policy("B:rsi-reversion:MES", "paused", 21), policy("A", "paused", 29), policy("B:rsi-reversion:MNQ", "resumed", 7), policy("B:rsi-reversion:MNQ", "paused", 29)];
    const v2 = quietReasons(overview([]), pol, NOW);
    expect(v2).toEqual(["2 methods are paused after a losing streak (RSI reversion · MES, Zone setups · S&P + Nasdaq). Their ideas are held back from the bot."]);
    const v3 = quietReasons(overview([], { riskPerTrade: 100, totalOpenRisk: 200, dailyLoss: 400, maxDrawdown: 2000, capital: 10000, singleContractMax: 150 }), pol, NOW);
    expect(v3[0]).toMatch(/The bot still decides their ideas\.$/);
  });

  it("uses the campaign's own limit in v3 wording", () => {
    const lines = quietReasons(overview([skip("risk-budget", 1)], { riskPerTrade: 100, totalOpenRisk: 200, dailyLoss: 400, maxDrawdown: 2000, capital: 10000, singleContractMax: 150 }), [], NOW);
    expect(lines[0]).toBe("1 idea skipped this week: one contract would risk more than $150.");
  });

  it("says plainly when the methods simply had no ideas", () => {
    expect(quietReasons(overview([]), [], NOW)).toEqual(["The methods produced no new ideas this week. Quiet stretches are normal; they wait for their setups."]);
    expect(quietReasons(null, [], NOW)).toEqual([]);
  });
});
