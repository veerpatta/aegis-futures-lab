import { expect, test, type Page } from "@playwright/test";

const bars = Array.from({ length: 80 }, (_, index) => {
  const close = 5000 + index * 0.25;
  return {
    time: 1_754_000_000 + index * 300,
    open: close - 0.25,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index,
  };
});

async function stubExternalData(page: Page, historyRequests: string[]) {
  await page.addInitScript(() => localStorage.setItem("aegis.guideSeen.v1", "1"));
  await page.route("**/api/history?*", async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") ?? "MES";
    historyRequests.push(symbol);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        mode: "delayed",
        delayed: true,
        source: "e2e",
        session: "NY",
        range: "60d",
        interval: "5m",
        fetchedAt: "2026-08-25T00:00:00.000Z",
        firstTimestamp: "2026-08-01T00:00:00.000Z",
        lastTimestamp: "2026-08-25T00:00:00.000Z",
        bars,
      }),
    });
  });
  await page.route("**/api/market?*", async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol") ?? "MES";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        mode: "delayed",
        delayed: true,
        source: "e2e",
        price: bars.at(-1)!.close,
        previousClose: bars.at(-2)!.close,
        change: 0.25,
        fetchedAt: "2026-08-25T00:00:00.000Z",
        dataTimestamp: "2026-08-25T00:00:00.000Z",
        bars,
      }),
    });
  });
  await page.route("**/api/events", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        source: "e2e",
        verified: true,
        coverage: [],
        limitation: "fixture",
        events: [],
      }),
    }),
  );
  await page.route("https://*.neon.tech/**/rest/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0" },
      body: "[]",
    }),
  );
}

test("Today reaches a useful state without downloading any 60-day history", async ({ page }) => {
  const historyRequests: string[] = [];
  await stubExternalData(page, historyRequests);

  await page.goto("/");
  await expect(page.getByText("Virtual only · Delayed prices · No real money")).toBeVisible();
  await page.waitForTimeout(500);

  expect(historyRequests).toEqual([]);
});

test("Chart loads only the market on screen", async ({ page }) => {
  const historyRequests: string[] = [];
  await stubExternalData(page, historyRequests);

  await page.goto("/markets");
  await expect(page.getByRole("heading", { name: "Chart" })).toBeVisible();
  await expect.poll(() => [...new Set(historyRequests)].sort()).toEqual(["MES"]);

  await page.getByRole("group", { name: "Select symbol" }).getByRole("button", { name: "MNQ" }).click();
  await expect.poll(() => [...new Set(historyRequests)].sort()).toEqual(["MES", "MNQ"]);
  // No strategy dropdown any more — the engine's own check explains a quiet day.
  await expect(page.getByText("Why no idea right now?")).toBeVisible();
});

for (const width of [320, 390]) test(`${width}px Chart shows the loaded range and retains touch controls`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubExternalData(page, []);
  await page.goto("/markets");
  await expect(page.getByRole("region", { name: "Market clock" })).toBeVisible();
  const range = page.getByRole("region", { name: "Range on this chart" });
  await expect(range).toContainText("80 candles");
  await expect(range).toContainText("4,999.00");
  await expect(range).toContainText("5,020.75");
  await expect(range).toContainText("Loaded candles, not a forecast");
  await page.getByRole("group", { name: "Timeframe" }).getByRole("button", { name: "1H", exact: true }).click();
  await expect(range).not.toContainText("80 candles");
  await page.getByRole("button", { name: "Candles", exact: true }).click();
  await expect(page.getByRole("button", { name: "Candles", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Lab deep links request only the strategy-specific metals history", async ({ page }) => {
  const historyRequests: string[] = [];
  await stubExternalData(page, historyRequests);

  await page.goto("/lab?s=gold-silver-zone");
  await expect(page.getByRole("heading", { name: "Strategy Lab" })).toBeVisible();
  await expect.poll(() => [...new Set(historyRequests)].sort()).toEqual(["MGC", "SI"]);
});
