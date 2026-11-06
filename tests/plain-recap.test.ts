import { describe, expect, it } from "vitest";
import { decisionsToday, todayRecap, tradeStory } from "@/lib/plain/recap";
import { methodName } from "@/lib/plain/strategies";
import type { ExpOverview, ExpTradeRow } from "@/lib/experiment/view";

const cash = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;
// Friday 2026-11-06, 16:00 UTC = 11:00 New York (EST).
const NOW = Date.parse("2026-11-06T16:00:00Z") / 1000;

function overview(over: Partial<ExpOverview> = {}): ExpOverview {
  return {
    lineage: "learner",
    experiment: { id: "learner-3", lineage: "learner", campaign: 3, mode: "live", status: "active", status_reason: null, capital: 10000, started_at: "2026-11-06T14:56:18Z", data_label: "delayed" },
    risk: null,
    account: { equity: 9888.11, realized: -111.89, unrealized: 0, unpriced_positions: 0, peak: 10000, day_key: "2026-11-06", day_start_equity: 10000, daily_pnl: -111.89, open_risk: 0, day_halted: false, locked_at: null, stale_symbols: [], last_ok_tick_at: null, updated_at: "2026-11-06T15:51:00Z" },
    model: null, open_positions: [], latest_trade: null, today_reasons: {},
    today: { closed: 1, net: -111.89, wins: 0 }, campaign_totals: null, lifetime: null, latest_learning: null,
    last_runs: {}, last_success: {}, quota_level: null, equity_eod: [],
    recent_decisions: [
      { id: 36, opportunity_key: "B:rsi-reversion:MES:1793977500", action: "take", reason: "taken", qty: 1, decided_at: "2026-11-06T15:10:00Z", position_status: "closed", net: -111.89 },
      { id: 35, opportunity_key: "x", action: "skip", reason: "risk-budget", qty: 0, decided_at: "2026-11-04T15:10:00Z", position_status: null, net: null },
    ],
    ...over,
  } as ExpOverview;
}

describe("today's recap in the app's own words", () => {
  it("counts only the current New York trading day's decisions", () => {
    expect(decisionsToday(overview(), NOW).map((d) => d.id)).toEqual([36]);
    // After 18:00 New York the session belongs to the next trading day.
    expect(decisionsToday(overview(), Date.parse("2026-11-06T23:30:00Z") / 1000)).toEqual([]);
  });

  it("reads naturally for one idea and one finished trade", () => {
    expect(todayRecap(overview(), NOW, cash)).toEqual([
      "Today the bot looked at 1 idea and took it.",
      "One trade finished today and lost: −$111.89 after costs.",
      "Since this campaign began on Nov 6, the virtual balance is down $111.89.",
    ]);
  });

  it("says plainly when nothing has happened yet, and mentions open trades", () => {
    const quiet = overview({ recent_decisions: [], today: { closed: 0, net: 0, wins: 0 },
      open_positions: [{ status: "open" } as ExpOverview["open_positions"][number]],
      account: { ...overview().account!, equity: 10000 } });
    expect(todayRecap(quiet, NOW, cash)).toEqual([
      "No new ideas have reached the bot yet today.",
      "1 trade is still open.",
      "The virtual balance is still at its starting amount since this campaign began on Nov 6.",
    ]);
    expect(todayRecap(null, NOW, cash)).toEqual([]);
  });
});

describe("one trade's story", () => {
  const row = {
    action: "take", reason: "taken", symbol: "MES", side: "SHORT", qty: 1, position_status: "closed", fill_price: 7438.75, exit_price: 7460.65,
    exit_reason: "stop", cancel_reason: null, net: -111.89, fill_ts: "2026-11-06T15:10:00Z", exit_ts: "2026-11-06T15:20:00Z",
    idea: { strategy: "rsi-reversion", entry: 7437.75, stop: 7460.4, target: 7403.78, signalTs: 1793977500, tier: "B", regime: null, score: null, rr: 1.5 },
  } as unknown as ExpTradeRow;

  it("tells a finished trade with its method, prices, time held and result", () => {
    const story = tradeStory(row, cash);
    expect(story).toContain("The bot sold 1 contract of the S&P micro at 7,438.75, betting that the price would fall, using the RSI reversion");
    expect(story).toContain("It closed after 10 minutes at 7,460.65 (stopped out).");
    expect(story.endsWith("The result was −$111.89 after costs.")).toBe(true);
  });

  it("tells skipped and unfilled ideas without inventing a result", () => {
    const skipped = tradeStory({ ...row, action: "skip", reason: "risk-budget", position_status: null, net: null }, cash);
    expect(skipped).toContain("The bot skipped it: one contract would risk more than $100.");
    expect(skipped).not.toContain("result was");
    const unfilled = tradeStory({ ...row, position_status: "cancelled", cancel_reason: "stop-breached", net: null }, cash);
    expect(unfilled).toContain("the order was not filled (the next price was already past the stop), so no money changed.");
  });

  it("names methods briefly and falls back to the id", () => {
    expect(methodName("zone-v5")).toBe("Zone setups");
    expect(methodName("something-new")).toBe("something-new");
    expect(methodName(null)).toBe("Unknown method");
  });
});
