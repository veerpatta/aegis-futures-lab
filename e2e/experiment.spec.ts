import { test, expect, type Page } from "@playwright/test";

/* The experimental learner's screens with stubbed data: Today's card and its
   three state chips, the Trades ledger and a trade's evidence, the Learn
   history, account separation, and the offline read-only state. */

const now = new Date();
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();

const overview = {
  lineage: "learner",
  experiment: { id: "learner-1", lineage: "learner", campaign: 1, mode: "live", status: "active", status_reason: null, capital: 10000, started_at: iso(60 * 24 * 3), data_label: "delayed" },
  risk: { capital: 10000, riskPerTrade: 100, totalOpenRisk: 200, dailyLoss: 400, maxDrawdown: 2000 },
  account: {
    equity: 9984.6, realized: -18.2, unrealized: 2.8, unpriced_positions: 0, peak: 10012, day_key: "2026-10-07", day_start_equity: 10000,
    daily_pnl: -15.4, open_risk: 61.2, day_halted: false, locked_at: null, stale_symbols: [], last_ok_tick_at: iso(6), updated_at: iso(6),
  },
  model: { version_id: "learner-1:v1-take-all", previous_version_id: null, since: iso(60 * 24 * 3), kind: "take_all", spec: {}, status: "adopted" },
  open_positions: [
    {
      id: "learner-1:A:zone-v5:MES:9", decision_id: 9, decision_key: "learner-1:A:zone-v5:MES:9", opportunity_key: "A:zone-v5:MES:9", symbol: "MES", side: "LONG", qty: 1,
      stop: 5990, target: 6020, status: "open", fill_ts: iso(30), fill_price: 6000.25, mark: 6001.5, mark_ts: iso(10), stale: false, exit_ts: null, exit_price: null,
      exit_reason: null, net: null, risk: 51.15, decided_at: iso(32), provenance: "prospective", model_version_id: "learner-1:v1-take-all", idea: { strategy: "zone-v5" },
    },
  ],
  latest_trade: {
    id: "learner-1:A:zone-v5:MNQ:7", decision_id: 7, decision_key: "learner-1:A:zone-v5:MNQ:7", opportunity_key: "A:zone-v5:MNQ:7", symbol: "MNQ", side: "SHORT", qty: 1,
    stop: 20520, target: 20460, status: "closed", fill_ts: iso(200), fill_price: 20500, mark: 20508, mark_ts: iso(150), stale: false, exit_ts: iso(150), exit_price: 20508,
    exit_reason: "stop", net: -18.2, risk: 44, decided_at: iso(205), provenance: "prospective", model_version_id: "learner-1:v1-take-all", idea: { strategy: "zone-v5" },
  },
  today_reasons: { taken: 2, "model-skip": 0, "session-over": 1 },
  today: { closed: 2, net: -15.4, wins: 1 },
  campaign_totals: { closed: 5, net: -18.2, wins: 2, fees: 12 },
  lifetime: { campaigns: 1, closed: 5, net: -18.2, first_start: iso(60 * 24 * 3) },
  latest_learning: { id: 4, kind: "rejected", from_version: "learner-1:2026-W40:c1", to_version: null, reason: "beatsIncumbent, beatsRandom", created_at: iso(60 * 24) },
  last_runs: { tick: { status: "ok", started_at: iso(6), finished_at: iso(6), message: "Watching", quota_level: "normal", counts: {} } },
  last_success: { tick: iso(6) },
  quota_level: "normal",
  equity_eod: [],
  recent_decisions: [{ id: 9, opportunity_key: "A:zone-v5:MES:1", action: "take", reason: "taken", qty: 1, decided_at: iso(32), position_status: "open", net: null }],
};

const trade = {
  id: 7, decision_key: "learner-1:A:zone-v5:MNQ:7", experiment_id: "learner-1", opportunity_key: "A:zone-v5:MNQ:7", signal_id: 7, symbol: "MNQ", side: "SHORT",
  session_key: "2026-10-07", seen_at: iso(206), info_cutoff: iso(206), decided_at: iso(205), provenance: "prospective", model_version_id: "learner-1:v1-take-all",
  p_win: null, threshold: null, action: "take", reason: "taken", qty: 1, est_risk: 44, ref_price: 20499,
  idea: { entry: 20500, stop: 20520, target: 20460, strategy: "zone-v5", signalTs: 0, tier: "A", regime: "trend-high-vol", score: 1, rr: 2 },
  features: { tier: "A", regime: "trend-high-vol", atr_pct: 0.12 }, feature_version: "exp-features-1", snapshot_hash: "abcdef0123456789abcdef",
  position_id: "learner-1:A:zone-v5:MNQ:7", position_status: "closed", cancel_reason: null, fill_ts: iso(200), fill_price: 20500, entry_slip: 0.25, risk: 44,
  mark: 20508, mark_ts: iso(150), stale: false, exit_ts: iso(150), exit_price: 20508, exit_slip: 0.25, exit_reason: "stop", ambiguous: true, gross: -16, fees: 2.4,
  net: -18.4, shadow_status: "closed", shadow_void_reason: null, shadow_qty: 2, shadow_exit_reason: "stop", shadow_net_per_contract: -18.4, shadow_ambiguous: true,
  mode: "live", data_label: "delayed", campaign: 1, lineage: "learner",
};

const learning = {
  lineage: "learner", experiment_id: "learner-1", mode: "live", prereg: {}, active_version_id: "learner-1:v1-take-all",
  versions: [
    { id: "learner-1:v1-take-all", kind: "take_all", spec: {}, week_key: "2026-W40", registered_at: iso(60 * 24 * 3), status: "adopted", status_reason: "frozen control", trained_at: null, threshold: null, train: null },
    { id: "learner-1:2026-W40:c1", kind: "logit", spec: { windowSessions: 60, featureSet: "v2", l2: 0.01 }, week_key: "2026-W40", registered_at: iso(60 * 24 * 2), status: "rejected", status_reason: "beatsIncumbent", trained_at: iso(60 * 24 * 2), threshold: { tau: 0.45 }, train: { n: 64 } },
  ],
  evaluations: [
    {
      id: 3, model_version_id: "learner-1:2026-W40:c1", incumbent_version_id: "learner-1:v1-take-all", kind: "walk_forward", n_oos: 160, n_sessions: 30, total_outcomes: 190,
      metrics: { delta: { est: -4, lo: -9, hi: -1 }, expectancy: { est: -2, lo: -5, hi: 1 }, randomPct: 40, stressP95: 900, costStressNet: -100, brierC: 0.26, brierInc: 0.25, takeRate: 0.4,
        checks: { enoughOutcomes: true, beatsIncumbent: false, beatsNoTrade: false, beatsRandom: false, drawdownOk: true, survivesDoubleCosts: false, betterCalibrated: false } },
      verdict: "fail", reasons: ["beatsIncumbent"], created_at: iso(60 * 24), window_from: iso(60 * 24 * 40), window_to: iso(60 * 24),
    },
  ],
  changes: [
    { id: 4, kind: "rejected", from_status: null, to_status: null, from_version: "learner-1:2026-W40:c1", to_version: null, reason: "beatsIncumbent, beatsRandom", evidence: {}, actor: "system", created_at: iso(60 * 24) },
    { id: 1, kind: "campaign_started", from_status: null, to_status: "active", from_version: null, to_version: "learner-1:v1-take-all", reason: "first campaign", evidence: {}, actor: "owner", created_at: iso(60 * 24 * 3) },
  ],
  progress: { closed_outcomes: 190, closed_prospective: 170, sessions_prospective: 30, decisions: 260, taken: 120 },
  latest_dataset: null,
};

async function stub(page: Page) {
  await page.route("**/api/events", (r) => r.fulfill({ json: { events: [], verified: true } }));
  await page.route("**/api/market?*", (r) => r.fulfill({ json: { price: 6001, previousClose: 5990, change: 11, dataTimestamp: now.toISOString(), bars: [] } }));
  await page.route("**/api/history?*", (r) => r.fulfill({ json: { bars: [] } }));
  await page.route("https://*.neon.tech/**/rest/v1/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/experiment_overview")) return r.fulfill({ json: [overview] });
    if (path.endsWith("/experiment_learning")) return r.fulfill({ json: [learning] });
    if (path.endsWith("/experiment_trades")) return r.fulfill({ json: [trade] });
    return r.fulfill({ json: [] });
  });
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [320, 390, 430])
  test(`${width}px Today shows the learner plainly and separately`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stub(page);
    await page.goto("/");
    const card = page.getByRole("region", { name: "Experimental learner" });
    await expect(card).toContainText("VIRTUAL ONLY");
    await expect(card).toContainText("delayed data");
    await expect(card).toContainText("$9,984.60");
    await expect(card.getByRole("button", { name: /^Doing:/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Learning: Candidate rejected/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Data:/ })).toBeVisible();
    await expect(card).toContainText("1 open virtual trade");
    // Practice money stays its own card.
    await expect(page.getByRole("region", { name: "Practice money" })).toBeVisible();
    expect(await noSideways(page)).toBe(true);
  });

test("Trades lists bot decisions and a trade shows its evidence", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/trades");
  await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
  await expect(page.getByText("Stopped out").first()).toBeVisible();
  await page.getByRole("button", { name: "Skipped", exact: true }).click();
  await page.getByRole("link", { name: /Nasdaq micro/ }).first().click();
  await expect(page).toHaveURL(/\/trades\/7$/);
  await expect(page.getByRole("region", { name: "What happened" })).toContainText("Stopped out");
  await expect(page.getByRole("region", { name: "What happened" })).toContainText("touched both the stop and the target");
  await expect(page.getByRole("region", { name: "Why it entered" })).toContainText("frozen control");
  await expect(page.getByRole("region", { name: "What was learned" })).toContainText("One result is not a pattern");
  expect(await noSideways(page)).toBe(true);
});

test("Learn shows the active model, verdicts with failed checks and the change history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/brain");
  await expect(page.getByRole("heading", { name: "Learn", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Bot status" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Active model" })).toContainText("v1 · take every idea");
  await expect(page.getByRole("region", { name: "Reviews" })).toContainText("Rejected");
  await expect(page.getByRole("region", { name: "Reviews" })).toContainText("Clearly better than the current model");
  await expect(page.getByRole("region", { name: "Change history" })).toContainText("Campaign started");
  const nav = page.getByRole("navigation", { name: /primary/i });
  for (const tab of ["Today", "Trades", "Learn", "Chart", "More"]) await expect(nav).toContainText(tab);
});

test("offline, the learner card says so and keeps the last figures read-only", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Experimental learner" })).toContainText("$9,984.60");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: /^Data: Offline/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Experimental learner" })).toContainText("$9,984.60");
  await context.setOffline(false);
});

test("More holds Ideas and practice money, and the old URLs still work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/more");
  await expect(page.getByRole("link", { name: /Ideas/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Practice money/ })).toBeVisible();
  await page.goto("/signals");
  await expect(page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: "More" })).toHaveClass(/tabActive/);
});
