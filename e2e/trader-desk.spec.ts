import { test, expect } from "@playwright/test";

for (const width of [360, 390, 430, 1440]) for (const mode of ["scanning", "open", "waiting", "paused", "locked", "error"]) {
  test(`${width}px ${mode} virtual account is clear and usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const now = "2026-10-08T15:00:00Z";
    await page.clock.install({ time: new Date(now) });
    await page.route("**/api/events", (r) => r.fulfill({ json: { events: [], verified: true } }));
    await page.route("**/api/market?*", (r) => r.fulfill({ json: { price: 5000, dataTimestamp: now, bars: [] } }));
    await page.route("https://*.neon.tech/**/rest/v1/**", (r) => {
      if (new URL(r.request().url()).pathname.endsWith("/experiment_overview")) return r.fulfill({ json: [{
        lineage: "learner", experiment: { id: "learner-2", lineage: "learner", campaign: 2, mode: "live", execution_clock: "delayed_market", status: mode === "paused" || mode === "locked" ? mode : "active", capital: 10000, started_at: now },
        account: { equity: 10000, peak: 10000, realized: 0, unrealized: 0, unpriced_positions: 0, open_risk: 0, daily_pnl: 0, day_halted: mode === "waiting", locked_at: mode === "locked" ? now : null, stale_symbols: [], last_ok_tick_at: now, data_as_of: "2026-10-08T14:45:00Z", backlog_count: 0 },
        risk: { capital: 10000, riskPerTrade: 100, totalOpenRisk: 200, dailyLoss: 400, maxDrawdown: 2000 },
        open_positions: mode === "open" ? [{ id: "open-1", decision_id: 1, symbol: "MES", side: "LONG", qty: 1, status: "pending_fill", mark: null, fill_price: null, net: null }] : [],
        last_runs: { tick: { status: mode === "error" ? "error" : "ok", started_at: now, counts: {} } }, today_reasons: {}, today: { closed: 0, net: 0 }, campaign_totals: { closed: 0, net: 0, fees: 0 }, lifetime: { net: 0 }, equity_eod: [], recent_decisions: [],
      }] });
      return r.fulfill({ json: [] });
    });
    await page.goto("/brain");
    const account = page.getByRole("region", { name: "Experimental learner" });
    const doing = { scanning: "Watching the market", open: "Managing trades", waiting: "Waiting", paused: "Paused", locked: "Stopped", error: "Last check failed" }[mode];
    await expect(account.getByRole("button", { name: new RegExp(`^Doing: ${doing}`) })).toBeVisible();
    await expect(account).toContainText("$10,000.00");
    await expect(page.getByRole("region", { name: "Practice money" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await account.getByRole("button", { name: "Rules", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("pretend account");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Hide money figures" }).click();
    await expect(account.getByText("$10,000.00", { exact: true })).toHaveCount(0);
    await page.goto("/more");
    await expect(page.getByRole("link", { name: /Guide/ }).last()).toBeVisible();
  });
}
