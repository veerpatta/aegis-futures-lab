import { describe, expect, it } from "vitest";
import {
  diffSignalAlerts,
  escapeHtml,
  formatAlertMessage,
  type AlertSignal,
} from "../scripts/engine/alerts";

/* The Telegram alert pipeline is a pure diff over (old status by dedupe_key,
   rows about to be written) plus a formatter. The engine rewrites every row
   every run, so "unchanged" must produce silence. */

const signal = (over: Partial<AlertSignal>): AlertSignal => ({
  dedupe_key: "B:rsi-reversion:MES:1000",
  tier: "B",
  symbol: "MES",
  direction: "long",
  entry_price: 6234.5,
  stop_price: 6228.25,
  target_price: 6247,
  rr: 2,
  status: "triggered",
  pnl_usd: null,
  signal_ts: "2026-07-23T13:35:00.000Z",
  ...over,
});

describe("diffSignalAlerts", () => {
  it("flags a brand-new key and a pending→triggered flip as opened", () => {
    const fresh = signal({ dedupe_key: "k1" });
    const flipped = signal({ dedupe_key: "k2" });
    const { opened, closed } = diffSignalAlerts(
      new Map([["k2", "pending"]]),
      [fresh, flipped]
    );
    expect(opened.map((s) => s.dedupe_key)).toEqual(["k1", "k2"]);
    expect(closed).toEqual([]);
  });

  it("flags triggered→terminal as closed", () => {
    const won = signal({ dedupe_key: "k1", status: "hit_target", pnl_usd: 118 });
    const lost = signal({ dedupe_key: "k2", status: "hit_stop", pnl_usd: -74 });
    const flat = signal({ dedupe_key: "k3", status: "expired", pnl_usd: -4 });
    const { opened, closed } = diffSignalAlerts(
      new Map([
        ["k1", "triggered"],
        ["k2", "triggered"],
        ["k3", "triggered"],
      ]),
      [won, lost, flat]
    );
    expect(opened).toEqual([]);
    expect(closed.map((s) => s.dedupe_key)).toEqual(["k1", "k2", "k3"]);
  });

  it("stays silent when statuses did not change", () => {
    const same = signal({ dedupe_key: "k1", status: "hit_target", pnl_usd: 118 });
    const stillOpen = signal({ dedupe_key: "k2", status: "triggered" });
    const { opened, closed } = diffSignalAlerts(
      new Map([
        ["k1", "hit_target"],
        ["k2", "triggered"],
      ]),
      [same, stillOpen]
    );
    expect(opened).toEqual([]);
    expect(closed).toEqual([]);
    expect(formatAlertMessage({ opened, closed })).toBeNull();
  });
});

describe("formatAlertMessage", () => {
  it("writes the paper-idea line with both clocks and the disclaimer", () => {
    const msg = formatAlertMessage(diffSignalAlerts(new Map(), [signal({})]))!;
    expect(msg).toContain("🟢 NEW IDEA — Tier B MES LONG @ 6234.50");
    expect(msg).toContain("stop 6228.25");
    expect(msg).toContain("target 6247.00");
    expect(msg).toContain("R:R 2.0");
    // 13:35Z on 2026-07-23 = 09:35 EDT = 19:05 IST — derived, never hardcoded.
    expect(msg).toContain("09:35 ET / 19:05 IST");
    expect(msg).toContain("(paper idea — not an order)");
    expect(msg).toContain("simulation only");
  });

  it("marks a brand-new key that arrived already resolved", () => {
    const msg = formatAlertMessage(
      diffSignalAlerts(new Map(), [signal({ status: "hit_target", pnl_usd: 118 })])
    )!;
    expect(msg).toContain("already closed: +$118");
  });

  it("formats wins, losses and flats with signed P&L", () => {
    const alerts = diffSignalAlerts(
      new Map([
        ["w", "triggered"],
        ["l", "triggered"],
        ["f", "triggered"],
      ]),
      [
        signal({ dedupe_key: "w", status: "hit_target", pnl_usd: 118 }),
        signal({ dedupe_key: "l", status: "hit_stop", pnl_usd: -74, direction: "short" }),
        signal({ dedupe_key: "f", status: "expired", pnl_usd: -4 }),
      ]
    );
    const msg = formatAlertMessage(alerts)!;
    expect(msg).toContain("🎯 TARGET HIT — Tier B MES LONG @ 6234.50 · +$118");
    expect(msg).toContain("🛑 STOPPED — Tier B MES SHORT @ 6234.50 · −$74");
    expect(msg).toContain("⌛ EXPIRED flat — Tier B MES LONG @ 6234.50 · −$4");
  });

  it("truncates long batches with a count instead of blowing the cap", () => {
    const rows = Array.from({ length: 100 }, (_, i) => signal({ dedupe_key: `k${i}` }));
    const msg = formatAlertMessage(diffSignalAlerts(new Map(), rows), 1000)!;
    expect(msg.length).toBeLessThanOrEqual(1000);
    expect(msg).toMatch(/…and \d+ more/);
  });

  it("escapes HTML in dynamic fields", () => {
    expect(escapeHtml("<b>&x")).toBe("&lt;b&gt;&amp;x");
    const msg = formatAlertMessage(
      diffSignalAlerts(new Map(), [signal({ symbol: "M<S&" })])
    )!;
    expect(msg).toContain("M&lt;S&amp;");
  });
});
