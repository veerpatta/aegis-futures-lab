import { test, expect, type Page } from "@playwright/test";

/* The experimental learner's screens with stubbed data: Today's card and its
   three state chips, the Trades ledger and a trade's evidence, the Learn
   history, account separation, and the offline read-only state. */

const now = new Date();
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();

const overview = {
  lineage: "learner",
  experiment: { id: "learner-1", lineage: "learner", campaign: 1, mode: "live", status: "active", status_reason: null, capital: 10000, started_at: iso(60 * 24 * 3), data_label: "delayed", execution_clock: "delayed_market" },
  risk: { capital: 10000, riskPerTrade: 100, totalOpenRisk: 200, dailyLoss: 400, maxDrawdown: 2000 },
  account: {
    equity: 9984.6, realized: -18.2, unrealized: 2.8, unpriced_positions: 0, peak: 10012, day_key: "2026-10-07", day_start_equity: 10000,
    daily_pnl: -15.4, open_risk: 61.2, day_halted: false, locked_at: null, stale_symbols: [], last_ok_tick_at: iso(6), updated_at: iso(6), data_as_of: iso(20), backlog_count: 0,
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
  mode: "live", data_label: "delayed", campaign: 1, lineage: "learner", execution_clock: "delayed_market", observed_at: iso(170), recorded_at: iso(6),
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
  latest_dataset: { id: "dataset-test", built_at: iso(60), cutoff: iso(60), row_count: 190, rows_hash: "test" },
};

async function stub(page: Page, hist: unknown[] = [history]) {
  await page.route("**/api/events", (r) => r.fulfill({ json: { events: [], verified: true } }));
  await page.route("**/api/market?*", (r) => r.fulfill({ json: { price: 6001, previousClose: 5990, change: 11, dataTimestamp: now.toISOString(), bars: [] } }));
  await page.route("**/api/history?*", (r) => r.fulfill({ json: { bars: [] } }));
  await page.route("https://*.neon.tech/**/rest/v1/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/experiment_overview")) return r.fulfill({ json: [overview] });
    if (path.endsWith("/experiment_learning")) return r.fulfill({ json: [learning] });
    if (path.endsWith("/experiment_trades")) return r.fulfill({ json: [trade] });
    if (path.endsWith("/history_overview")) return r.fulfill({ json: hist });
    return r.fulfill({ json: [] });
  });
}


const folds = [1, 2, 3, 4, 5].map((fold) => ({ fold, trainRows: 60 * fold, purgedRows: 4, testRows: 40, trainSessions: 50 * fold, testSessions: 30, valid: true }));
const period = (n: number) => ({
  nOos: n, nSessions: 120, folds: 5, delta: { est: 1.2, lo: -2.1, hi: 4.4 }, expectancy: { est: 0.8, lo: -3.0, hi: 4.1 }, randomPct: 71, stressP95: 820, costStressNet: -140,
  brierC: 0.243, brierInc: 0.251, brierBase: 0.249, logLossC: 0.68, logLossBase: 0.69, takeRate: 0.55, chalNet: 96, incNet: -40, maxDrawdown: 610, selected: Math.round(n * 0.55), costs: 455,
  portfolio: { candidate: { net: 88, maxDrawdown: 590, trades: Math.round(n * 0.5) }, incumbent: { net: -52, maxDrawdown: 700, trades: n - 4 } },
});
const history = {
  id: "hist-2026-10-07", version: "hist-study-2026-10-07", status: "evaluated", status_reason: "final inconclusive (development-exposed)", registered_at: iso(300), updated_at: iso(60),
  observation_lag_sec: 1525, research_code_hash: "abc", code_sha: "sha",
  scope: { source: "databento", symbols: ["MES", "MNQ"], from: "2019-05-06", to: "2026-09-23" },
  prior_use: [{ from: "2019-05-06", to: "2026-07-29", use: "development", by: "Phase 1" }],
  permissions: [{ source: "Databento MES/MNQ archive", status: "licence scope not verified", handling: "private", openQuestion: "Confirm the licence allows the Data page's public redisplay." }],
  beginnings: { codeHistory: { date: "2026-07-17", evidence: "root" }, marketArchive: { date: "2019-05-06", evidence: "bar" }, experimentalLearner: { date: "2026-10-07", evidence: "run" } },
  controls: ["incumbent"], budget_caps: { initialBatchActiveMinutes: 30 }, register: {}, planned_chunks: 178,
  registered_trials: [{ windowSessions: 120, featureSet: "v1", l2: 0.001 }],
  split: { development: { from: "2019-05-20", to: "2023-10-02", sessions: 600, rows: 700 }, validation: { from: "2023-10-03", to: "2025-03-11", sessions: 200, rows: 240 }, final: { from: "2025-03-12", to: "2026-09-22", sessions: 200, rows: 230 } },
  dataset: { rawExamples: 5200, families: 2600, rows: 1170, sessions: 1000, exclusions: { "other-mode": 2600, "structural-void": 1300, "over-risk": 90, quarantined: 12, "duplicate-family": 0, "label-not-ready": 1, "no-features": 0 }, byStrategy: {}, bySymbol: {} },
  dataset_hash: "d", final_accessed_at: iso(60), budget: { replayActiveMs: 420000 },
  chunks: { done: 178, failed: 0, bars: 2100000, bytes: 1, runtime_ms: 420000, ideas: 5300, gaps: 31, missing_bars: 900, discontinuities: 4, ohlc_bad: 0, duplicates: 0, first_month: "2019-05", last_month: "2026-09" },
  examples: { total: 5200, observation: 2600, closed: 1260, quarantined: 12, by_reason: { taken: 1260, "idea-closed": 1200, "risk-budget": 90 }, take_all_net_observation: -2400, take_all_net_strategy: -3100, first_signal: iso(9999), last_signal: iso(100) },
  trials: [
    { ordinal: 1, spec: { windowSessions: 120, featureSet: "v1", l2: 0.001 }, status: "selected", reason: null, folds, development: period(200), validation: period(240) },
    { ordinal: 2, spec: { windowSessions: 60, featureSet: "v1", l2: 0.001 }, status: "failed_coverage", reason: "fold 1 has 41 training rows (needs 50)", folds: folds.map((f) => (f.fold === 1 ? { ...f, trainRows: 41, valid: false } : f)), development: null, validation: null },
  ],
  final: {
    trial_ordinal: 1, spec: { windowSessions: 120, featureSet: "v1", l2: 0.001 }, artifact_id: "hist-2026-10-07:t1", artifact_hash: "0123456789abcdef0123", train_cutoff: "2025-03-04T20:00:00Z", train_rows: 900,
    metrics: period(230), verdict: "inconclusive", reasons: ["beatsIncumbent"], checks: { enoughOutcomes: true, beatsIncumbent: false, beatsNoTrade: false, beatsRandom: false, drawdownOk: true, survivesDoubleCosts: false, betterCalibrated: true },
    development_exposed: true, shadow_eligible: true, shadow_version_id: "learner-1:hist:2026-10-07", shadow_registered_at: iso(30), evaluated_at: iso(60),
  },
  shadow: { version_id: "learner-1:hist:2026-10-07", status: "shadowing", status_reason: null, registered_at: iso(30), scored: 2, fresh_closed: 0, fresh_sessions: 0, reviews_passed: 0 },
  legacy_signals: { signals: 169, signals_closed: 167, signals_net: -1450, first_signal: iso(9999), last_signal: iso(10) },
  legacy_shadows: { shadows: 574, shadows_closed: 547, shadows_net: -2900 },
  last_run: { status: "ok", stage: "shadow", started_at: iso(30), finished_at: iso(30), message: "registered" },
};

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [320, 390]) test(`${width}px Today shortcuts and trade breakdown follow actual records`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stub(page);
  await page.goto("/");
  const pulse = page.getByRole("region", { name: "Today at a glance" });
  await expect(pulse).toContainText("Following virtual trades");
  expect(await noSideways(page)).toBe(true);
  await pulse.getByRole("link", { name: /Open trades/ }).click();
  await expect(page).toHaveURL(/trades\?view=open$/);
  await expect(page.getByRole("group", { name: "Show", exact: true }).getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Show", exact: true }).getByRole("button", { name: "All", exact: true }).click();
  const mix = page.getByRole("region", { name: "Decisions in this view" });
  await expect(mix).toContainText("1 shown");
  await expect(mix.getByRole("img")).toHaveAttribute("aria-label", /1 closed, 0 open, 0 waiting, 0 skipped, 0 no fill/);
  expect(await noSideways(page)).toBe(true);
});

test("More searches tools and keeps privacy and clock settings usable on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await stub(page);
  await page.goto("/more");
  await page.getByRole("searchbox", { name: "Find a tool" }).fill("journal");
  await expect(page.getByRole("status")).toContainText("1 tool found");
  await expect(page.getByRole("link", { name: /Journal Log your own/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Strategy Lab Test/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Find a tool" }).fill("nothing-matches");
  await expect(page.getByRole("status")).toContainText("No matching tools");
  await page.getByRole("button", { name: "Clear tool search" }).click();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "IST", exact: true }).click();
  await expect(settings).toContainText("India");
  const privacy = settings.getByRole("button", { name: "Hide money amounts", exact: true });
  await privacy.click();
  await expect(privacy).toHaveAttribute("aria-pressed", "true");
  await expect(settings).toContainText("Hidden");
  expect(await noSideways(page)).toBe(true);
  await page.reload();
  await expect(settings.getByRole("button", { name: "IST", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(privacy).toHaveAttribute("aria-pressed", "true");
});

for (const width of [320, 390])
  test(`${width}px trade widgets show actual fills, progress and masked money`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await stub(page);
    await page.goto("/trades");
    const summary = page.getByRole("region", { name: "Learner summary" });
    await expect(summary).toContainText("$9,984.60");
    const card = page.getByRole("region", { name: "Bot trades" }).getByRole("link").first();
    await expect(card).toContainText("−$18.40");
    await expect(card).toContainText("20,500.00");
    await expect(card.getByLabel("Trade progress")).toContainText("Filled");
    await expect(card.getByLabel("Trade progress")).toContainText("Closed");
    expect(await noSideways(page)).toBe(true);
    await page.getByRole("button", { name: "Hide money figures" }).click();
    await expect(summary).toContainText("Account chart hidden");
    await expect(card).toContainText("••••");
    await expect(card).not.toContainText("$18.40");
    await expect(card).toContainText("20,500.00");
  });

test("trade filters ignore an older response and reduced motion has no stagger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page);
  await page.route("https://*.neon.tech/**/rest/v1/experiment_trades*", async r => {
    const query = new URL(r.request().url()).searchParams;
    if (query.get("action") === "eq.skip") {
      await new Promise(resolve => setTimeout(resolve, 500));
      return r.fulfill({ json: [{ ...trade, id: 999, action: "skip", reason: "risk-budget", position_status: null, net: null }] });
    }
    return r.fulfill({ json: [trade] });
  });
  await page.goto("/trades");
  await expect(page.getByRole("region", { name: "Bot trades" })).toContainText("Stopped out");
  const slow = page.waitForResponse(r => r.url().includes("experiment_trades") && r.url().includes("action=eq.skip"));
  await page.getByRole("button", { name: "Skipped", exact: true }).click();
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await slow;
  const card = page.getByRole("region", { name: "Bot trades" }).getByRole("link").first();
  await expect(card).toHaveAttribute("href", "/trades/7");
  await expect(card).toContainText("Stopped out");
  const motion = await card.evaluate(el => ({ duration: getComputedStyle(el).animationDuration, delay: getComputedStyle(el).animationDelay }));
  expect(parseFloat(motion.duration)).toBeLessThan(.01);
  expect(parseFloat(motion.delay)).toBe(0);
});

test("open and unfilled cards keep estimated and unbooked results distinct", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.route("https://*.neon.tech/**/rest/v1/experiment_trades*", r => r.fulfill({ json: [
    { ...trade, id: 10, position_status: "open", side: "LONG", fill_price: 20500, mark: 20510, net: null, qty: 2, stale: true },
    { ...trade, id: 11, position_status: "pending_fill", fill_price: null, fill_ts: null, net: null },
    { ...trade, id: 12, position_status: "cancelled", fill_price: null, fill_ts: null, net: null, cancel_reason: "risk-budget" },
  ] }));
  await page.goto("/trades");
  const ledger = page.getByRole("region", { name: "Bot trades" });
  await expect(ledger.getByRole("link").nth(0)).toContainText("~+$35.20");
  await expect(ledger.getByRole("link").nth(0)).toContainText("stale");
  await expect(ledger.getByRole("link").nth(1)).toContainText("Pending");
  await expect(ledger.getByRole("link").nth(2)).toContainText("No fill");
  await expect(ledger.getByRole("link").nth(2).getByLabel("Trade progress")).toHaveCount(0);
  expect(await noSideways(page)).toBe(true);
});

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
    await expect(card).toContainText("Market data through");
    await expect(card).toContainText("One virtual account");
    await expect(page.getByRole("region", { name: "Practice money" })).toHaveCount(0);
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
  await expect(page.getByText("Simulated decision", { exact: true })).toBeVisible();
  await expect(page.getByText("Idea received", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Why it entered" })).toContainText("frozen control");
  await expect(page.getByRole("region", { name: "What was learned" })).toContainText("One result is not a pattern");
  expect(await noSideways(page)).toBe(true);
});

for (const width of [320, 390]) test(`${width}px bot companion shows evidence, motion control and the next hurdle`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stub(page);
  await page.goto("/brain");
  const activity = page.getByRole("region", { name: "Bot activity", exact: true });
  await expect(activity).toContainText("Following virtual trades");
  await expect(activity.locator('[data-mood]')).toHaveAttribute("data-animated", "true");
  await page.getByRole("button", { name: "Pause bot animation" }).click();
  await expect(activity.locator('[data-mood]')).toHaveAttribute("data-animated", "false");
  await page.getByRole("button", { name: "Resume bot animation" }).click();
  const notebook = page.getByRole("region", { name: "Learning progress", exact: true });
  await expect(notebook).toContainText("190 usable examples");
  await expect(notebook).toContainText("Enough examples to start training");
  await notebook.getByText("The path to a better bot").click();
  await expect(notebook).toContainText("60 fresh ideas over 20 trading days");
  await expect(activity.locator('[data-mood]')).toHaveAttribute("data-animated", "false");
  expect(await noSideways(page)).toBe(true);
});

test("bot rests offline and honors reduced motion without claiming new progress", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page);
  await page.goto("/brain");
  const activity = page.getByRole("region", { name: "Bot activity", exact: true });
  await expect(activity).toContainText("Following virtual trades");
  const motion = await activity.locator("svg g").evaluateAll(elements => elements.map(e => getComputedStyle(e).animationName));
  expect(motion.every(name => name === "none")).toBe(true);
  await expect(page.getByRole("region", { name: "Learning progress", exact: true })).toContainText("190 usable examples");
  await context.setOffline(true);
  await expect(activity).toContainText("Offline for now");
  await expect(activity.locator('[data-mood]')).toHaveAttribute("data-animated", "false");
  await expect(page.getByRole("region", { name: "Learning progress", exact: true })).toContainText("190 usable examples");
});

test("a stale running job is not shown as active training", async ({ page }) => {
  await stub(page);
  await page.route("**/experiment_overview?*", r => r.fulfill({ json: [{ ...overview, last_runs: { ...overview.last_runs, review: { status: "running", started_at: iso(90), finished_at: null, counts: {} } } }] }));
  await page.goto("/brain");
  const activity = page.getByRole("region", { name: "Bot activity", exact: true });
  await expect(activity).toContainText("Waiting for a report");
  await expect(activity.locator('[data-mood]')).toHaveAttribute("data-animated", "false");
});

test("Learn shows the active model, verdicts with failed checks and the change history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/brain");
  await expect(page.getByRole("heading", { name: "Learn", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Experimental learner" })).toContainText("$9,984.60");
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

test("More opens method research without a second account balance", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/more");
  await expect(page.getByRole("link", { name: /Ideas/ })).toBeVisible();
  await page.getByRole("link", { name: /Method research/ }).click();
  await expect(page.locator("#research")).toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Method qualification" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Practice money" })).toHaveCount(0);
  await page.goto("/signals");
  await expect(page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: "More" })).toHaveClass(/tabActive/);
});

for (const width of [320, 390])
  test(`${width}px Learn shows historical practice: the plan's copy, the checklist, and nothing added to the account`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await stub(page);
    await page.goto("/brain#history");
    const sec = page.getByRole("region", { name: "Historical practice" });
    await expect(sec).toContainText("Historical practice complete through 23 September. This result uses older market data and does not count as fresh trading days.", { timeout: 15_000 });
    await expect(sec).toContainText("The older candidate remains saved. Delayed simulations do not supply fresh confirmation. No validated improvement yet.");
    const list = sec.getByRole("region", { name: "Evidence checklist" });
    for (const item of ["Data ready", "Historical test complete", "Fresh confirmation waiting", "Validated paper improvement"]) await expect(list).toContainText(item);
    await expect(list).toContainText("Delayed simulations do not advance fresh confirmation");
    await expect(sec.getByRole("region", { name: "Older data replayed" })).toContainText("178 of 178");
    await expect(sec.getByRole("region", { name: "Candidate" })).toContainText("Inconclusive");
    await expect(sec.getByRole("region", { name: "Candidate" })).toContainText("already seen");
    await expect(sec.getByRole("region", { name: "Registered versions" })).toContainText("Too little data in a test period");
    await expect(sec.getByRole("region", { name: "History and safety" })).toContainText("no refill, no reset, no older profit added");
    // The verdict chip for "inconclusive" is amber, never green or red.
    await expect(sec.getByRole("region", { name: "Candidate" }).getByText("Inconclusive", { exact: true })).toHaveClass(/chip_amber/);
    expect(await noSideways(page)).toBe(true);
  });

test("historical practice before registration says so plainly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page, []);
  await page.goto("/brain#history");
  const sec = page.getByRole("region", { name: "Historical practice" });
  await expect(sec).toContainText("Historical practice has not started yet.");
  await expect(sec).toContainText("The study has not been registered yet.");
});

test("More links to historical practice", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto("/more");
  await page.getByRole("link", { name: /Historical practice/ }).click();
  await expect(page).toHaveURL(/\/brain#history$/);
});

const auditAt = "2026-10-09T16:00:00Z";
const auditRuns = Array.from({ length: 71 }, (_, id) => ({ id, ran_at: auditAt, status: "ok", message: "Watching; no new ideas", symbols: ["MES", "MNQ"] }));
const auditBreaker = { paused: true, measuredAt: auditAt, pausedAt: "2026-10-01T16:00:00Z", triggerReason: "rolling PF", triggerPf: 0.4, triggerWindow: 20, recoveryCount: 8, recoveryPf: 0.7, recoveryNoLosses: false, lastClosedAt: auditAt, daysSinceFlip: 6, frozen: false };
const auditFunnel = { dateKey: "2026-10-09", computedAt: auditAt, bars: { MES: 80, MNQ: 80 }, funnel: { noSignal: 50, hours: 10 }, staleData: false, worstBarAgeMin: 15,
  streams: [{ key: "A", tier: "A", label: "zone-v5", status: "benched", signalsToday: 0, breaker: auditBreaker }, { key: "B:rsi-reversion:MNQ", tier: "B", label: "rsi", status: "benched", signalsToday: 0, breaker: auditBreaker }, { key: "B:rsi-reversion:MES", tier: "B", label: "rsi", status: "active", signalsToday: 0, breaker: { ...auditBreaker, paused: false } }] };
async function auditStub(page: Page) {
  await page.clock.install({ time: new Date(auditAt) });
  await page.addInitScript(() => localStorage.setItem("aegis.displayZone.v1", "IST"));
  await stub(page);
  await page.route("https://*.neon.tech/**/rest/v1/**", async r => {
    const url = new URL(r.request().url()), path = url.pathname;
    if (path.endsWith("/engine_runs")) return r.fulfill({ json: auditRuns });
    if (path.endsWith("/learned_stats")) return r.fulfill({ json: [{ payload: auditFunnel }] });
    if (path.endsWith("/experiment_trades")) return r.fulfill({ json: url.searchParams.has("decided_at") ? [] : [trade] });
    return r.fallback();
  });
}
for (const width of [320, 390, 1280]) test(`${width}px activity separates successful checks, paused sources and zero learner decisions`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await auditStub(page);
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Trading activity" });
  await expect(panel).toContainText("71 succeeded");
  await expect(panel).toContainText("2026-10-09 · Calendar day in IST");
  await expect(panel).toContainText("2 source methods are withheld");
  await expect(panel.getByLabel("Daily activity summary")).toContainText("0Eligible ideas");
  const source = panel.locator("details").filter({ has: page.locator("summary", { hasText: "Zone setups" }) }).first();
  await source.locator("summary").first().click();
  await expect(source).toContainText("0.40 across 20 closed");
  await expect(source).toContainText("8/15 closed practice results");
  await expect(source.getByRole("progressbar")).toHaveAttribute("value", "8");
  await expect(panel).toContainText("Source practice never changes");
  expect(await noSideways(page)).toBe(true);
  await panel.screenshot({ path: `test-results/activity-${width}.png` });
});
test("activity preserves saved counts after a failed refresh and retries", async ({ page }) => {
  await auditStub(page); let fail = false;
  await page.route("https://*.neon.tech/**/rest/v1/engine_runs*", r => fail && new URL(r.request().url()).searchParams.has("ran_at") ? r.fulfill({ status: 400, json: { message: "fixture read failed" } }) : r.fallback());
  await page.goto("/"); const panel = page.getByRole("region", { name: "Trading activity" });
  await expect(panel).toContainText("71 succeeded"); fail = true;
  await panel.getByRole("button", { name: "Refresh trading activity" }).click();
  await expect(panel).toContainText("Showing the saved update");
  await expect(panel).toContainText("71 succeeded"); fail = false;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel).not.toContainText("Showing the saved update");
  await expect(panel).toContainText("71 succeeded");
});
test("activity ignores interrupted day reads and honours reduced motion", async ({ page }) => {
  await auditStub(page); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://*.neon.tech/**/rest/v1/engine_runs*", async r => {
    const day = new URL(r.request().url()).searchParams.getAll("ran_at").join(" ");
    if (day.includes("2026-10-07T18:30")) { await new Promise(resolve => setTimeout(resolve, 600)); return r.fulfill({ json: [{ ...auditRuns[0], id: 999, message: "old day" }] }); }
    return r.fallback();
  });
  await page.goto("/"); const panel = page.getByRole("region", { name: "Trading activity" });
  await expect(panel).toContainText("71 succeeded");
  const old = page.waitForResponse(r => r.url().includes("engine_runs") && decodeURIComponent(r.url()).includes("2026-10-07T18:30"));
  await panel.getByLabel("Day to review").fill("2026-10-08");
  await panel.getByRole("button", { name: "Today", exact: true }).click(); await old;
  await expect(panel).toContainText("71 succeeded");
  const duration = await panel.evaluate(el => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(.01);
});
test("skipped trade retries its own failed read and explains the saved account room", async ({ page }) => {
  await auditStub(page); let fail = true;
  const evidence = { version: 1, contractRisk: 61, openRisk: 170, openRoom: 30, dailyPnl: -15, dayRoom: 385, drawdown: 40, budget: 30, limits: { ...overview.risk, minStopPoints: 1 }, priceAt: 0, freshness: "fresh", campaignStatus: "active", dayHalted: false, quota: "normal" };
  await page.route("https://*.neon.tech/**/rest/v1/experiment_trades*", r => fail ? r.fulfill({ status: 400, json: { message: "fixture interruption" } }) : r.fulfill({ json: [{ ...trade, action: "skip", reason: "open-risk", position_status: null, net: null, idea: { ...trade.idea, decisionEvidence: evidence } }] }));
  await page.goto("/trades/7");
  await expect(page.getByText("This trade could not load.")).toBeVisible(); fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const result = page.getByRole("region", { name: "Result", exact: true });
  const explanation = page.getByRole("region", { name: "What happened", exact: true });
  await expect(explanation).toContainText("Already open: $170.00; room left: $30.00 of $200.00");
  await expect(result).toContainText("Campaign 1 · learner-1");
  await expect(explanation).toContainText("Simulated decision");
  await expect(explanation).toContainText("Idea received");
});

test("an unavailable activity read is not reported as zero decisions", async ({ page }) => {
  await auditStub(page);
  await page.route("https://*.neon.tech/**/rest/v1/engine_runs*", r => new URL(r.request().url()).searchParams.has("ran_at") ? r.fulfill({ status: 400, json: { message: "fixture unavailable" } }) : r.fallback());
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Trading activity" });
  await expect(panel).toContainText("Activity counts are unavailable");
  await expect(panel.getByLabel("Daily activity summary")).not.toContainText("0Eligible ideas");
  await expect(panel.getByLabel("Daily activity summary")).toContainText("Awaiting records");
});
