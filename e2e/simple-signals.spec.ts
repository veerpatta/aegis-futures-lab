import { test, expect, type Page } from "@playwright/test";

/* Today and Ideas at phone and desktop widths: the bot's status leads, every
   idea card carries its method's honest standing, sheets open and close, a
   tapped word explains itself, and nothing is wider than the screen. */

async function stub(page: Page, historyRequests: string[] = []) {
  const now = new Date().toISOString();
  const signal = {
    id: 1,
    tier: "A",
    symbol: "MES",
    dedupe_key: "A:zone-v5:MES:1",
    direction: "long",
    entry_price: 5000,
    stop_price: 4995,
    target_price: 5010,
    rr: 2,
    signal_ts: now,
    status: "triggered",
    pnl_usd: null,
    exit_ts: null,
    exit_price: null,
  };
  await page.route("**/api/events", (r) => r.fulfill({ json: { events: [], verified: true } }));
  await page.route("**/api/market?*", (r) => r.fulfill({ json: { price: 5000, previousClose: 4990, change: 10, dataTimestamp: now, bars: [] } }));
  await page.route("**/api/history?*", (r) => {
    historyRequests.push(new URL(r.request().url()).searchParams.get("symbol") ?? "?");
    return r.fulfill({ json: { bars: [] } });
  });
  await page.route("https://*.neon.tech/**/rest/v1/**", (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith("/signals")
        ? [
            signal,
            { ...signal, id: 2, dedupe_key: "A:zone-v5:MES:2", status: "hit_target", exit_ts: now, exit_price: 5010, pnl_usd: 47.6 },
            { ...signal, id: 3, dedupe_key: "A:zone-v5:MES:3", suppressed: true },
          ]
        : [],
    })
  );
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [360, 390, 430, 1440])
  test(`${width}px Today and Ideas read plainly`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stub(page);

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Bot status" })).toBeVisible();
    const ideas = page.getByRole("region", { name: "Latest trade ideas" });
    await expect(ideas).toContainText("Method hasn't beaten chance");
    await expect(ideas).toContainText("47.60");
    await expect(ideas.getByRole("button", { name: /Open details/ })).toHaveCount(2);
    expect(await noSideways(page)).toBe(true);

    await ideas.getByRole("button", { name: /Open details/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A tapped word opens its meaning, and Escape closes just that sheet.
    await page.getByRole("button", { name: /Practice money — what this means/ }).first().click();
    await expect(page.getByRole("dialog")).toContainText("paper account");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/signals");
    await expect(page.getByText("did no better than chance")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open · 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByRole("region", { name: "Trade ideas" })).toContainText("47.60");
    expect(await page.locator("details").first().getAttribute("open")).toBeNull();
    expect(await noSideways(page)).toBe(true);

    if (width < 768) {
      const nav = page.getByRole("navigation", { name: /primary/i });
      for (const tab of ["Today", "Trades", "Learn", "Chart", "More"]) await expect(nav).toContainText(tab);
    }
  });

test("Journal opens on your trades without downloading 60 days of prices", async ({ page }) => {
  const history: string[] = [];
  await stub(page, history);
  await page.goto("/replay");
  await expect(page.getByRole("heading", { name: "Journal", exact: true })).toBeVisible();
  await expect(page.getByText("Trading day")).toBeVisible();
  await page.waitForTimeout(500);
  expect(history).toEqual([]);
  await page.getByText(/Compare with the bot/).click();
  await expect.poll(() => [...new Set(history)].sort()).toEqual(["MES", "MNQ"]);
});

test("More highlights its tab on pages reached through it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/guide");
  const more = page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: "More" });
  await expect(more).toHaveClass(/tabActive/);
});
