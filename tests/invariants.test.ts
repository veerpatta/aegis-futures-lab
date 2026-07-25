import { describe, expect, it } from "vitest";
import {
  MAX_WORKFLOW_AGE_HOURS,
  SCHEDULED_WORKFLOWS,
  checkInvariants,
  formatInvariantReport,
  type InvariantInput,
} from "../scripts/engine/invariants";

/* Item 2.6. Both audits of this system found the same shape of bug: a
   structural failure with no error, no empty screen and no alert — just a
   number that was quietly meaningless. These are the invariants those bugs
   violated. */

const base: InvariantInput = {
  signals: [],
  shadow: [],
  latestStats: {},
  workflowAgeHours: {},
  maxWorkflowAgeHours: MAX_WORKFLOW_AGE_HOURS,
};

const sig = (over: Partial<InvariantInput["signals"][number]> = {}) => ({
  tier: "B",
  dedupe_key: "B:rsi-reversion:MES:1",
  status: "hit_target",
  pnl_usd: 100 as number | null,
  score: 80 as number | null,
  target_price: 10 as number | null,
  stale_data: false,
  ...over,
});

describe("checkInvariants — a clean system reports nothing", () => {
  it("is silent when there is genuinely no data to compute from", () => {
    expect(checkInvariants(base)).toEqual([]);
  });

  it("is silent when the stats match the data that exists", () => {
    const v = checkInvariants({
      ...base,
      signals: [sig(), sig({ pnl_usd: -50 })],
      latestStats: {
        score_calibration: { real: { total: 2, deciles: [{ decile: 1 }] } },
        condition_ledger: { tierRegime: { "B·trend-low-vol": { n: 2 } } },
        fill_reality: { weeks: [{ week: "2026-W30" }] },
      },
    });
    expect(v).toEqual([]);
  });
});

describe("the score_calibration bug", () => {
  it("fires when a stat is empty while its precondition rows exist", () => {
    const v = checkInvariants({
      ...base,
      signals: [sig(), sig(), sig()],
      latestStats: {
        score_calibration: { real: { total: 0, deciles: [] } },
        condition_ledger: { tierRegime: { x: { n: 3 } } },
        fill_reality: { weeks: [{ week: "2026-W30" }] },
      },
    });
    expect(v.map((x) => x.code)).toEqual(["stat_empty_with_data"]);
    expect(v[0].detail).toContain("score_calibration");
    expect(v[0].detail).toContain("3 closed signals carrying a score");
  });

  it("fires when the stat row is missing entirely", () => {
    const v = checkInvariants({ ...base, signals: [sig()] });
    expect(v.map((x) => x.code).sort()).toEqual(["stat_missing", "stat_missing", "stat_missing"]);
  });

  it("does NOT fire when the emptiness is honest — no scored closed rows", () => {
    const v = checkInvariants({
      ...base,
      // Exactly today's live shape: 20 closed tier-B rows, none with a score.
      signals: Array.from({ length: 20 }, () => sig({ score: null })),
      latestStats: {
        score_calibration: { real: { total: 0, deciles: [] } },
        condition_ledger: { tierRegime: { x: { n: 20 } } },
        fill_reality: { weeks: [{ week: "2026-W30" }] },
      },
    });
    expect(v).toEqual([]);
  });

  it("ignores stale-data rows when judging whether a precondition is met", () => {
    const v = checkInvariants({
      ...base,
      signals: Array.from({ length: 5 }, () => sig({ stale_data: true })),
      latestStats: {
        score_calibration: { real: { total: 0, deciles: [] } },
        condition_ledger: {},
        fill_reality: { weeks: [] },
      },
    });
    expect(v).toEqual([]);
  });
});

describe("the ema-cross bug", () => {
  it("fires when a targetless stream is presented with a win rate", () => {
    const v = checkInvariants({
      ...base,
      shadow: Array.from({ length: 28 }, () => ({
        strategy: "ema-cross",
        symbol: "MES",
        status: "expired",
        pnl_usd: -100,
        target_price: null,
      })),
      latestStats: {
        shadow_scoreboard: { streams: [{ strategy: "ema-cross", symbol: "MES", winRate: 14 }] },
      },
    });
    expect(v.map((x) => x.code)).toContain("winrate_without_target");
    expect(v.find((x) => x.code === "winrate_without_target")?.detail).toContain("28");
  });

  it("is satisfied once the 2.2b guard withholds the number", () => {
    const v = checkInvariants({
      ...base,
      shadow: Array.from({ length: 28 }, () => ({
        strategy: "ema-cross",
        symbol: "MES",
        status: "expired",
        pnl_usd: -100,
        target_price: null,
      })),
      latestStats: {
        shadow_scoreboard: { streams: [{ strategy: "ema-cross", symbol: "MES", winRate: null }] },
      },
    });
    expect(v.map((x) => x.code)).not.toContain("winrate_without_target");
  });

  it("leaves a bracketed stream's win rate alone", () => {
    const v = checkInvariants({
      ...base,
      shadow: [{ strategy: "orb", symbol: "MES", status: "hit_target", pnl_usd: 60, target_price: 12 }],
      latestStats: {
        shadow_scoreboard: { streams: [{ strategy: "orb", symbol: "MES", winRate: 100 }] },
      },
    });
    expect(v.map((x) => x.code)).not.toContain("winrate_without_target");
  });
});

describe("dead scheduled workflows", () => {
  it("fires past the 48-hour limit and names the count", () => {
    const v = checkInvariants({
      ...base,
      workflowAgeHours: { "Nightly learn": 12, "Weekly digest": 73 },
    });
    expect(v.map((x) => x.code)).toEqual(["workflow_stale"]);
    expect(v[0].detail).toContain("73h");
    expect(v[0].detail).toContain("48h");
  });

  it("fires for a workflow that has never run", () => {
    const v = checkInvariants({ ...base, workflowAgeHours: { Watchdog: null } });
    expect(v.map((x) => x.code)).toEqual(["workflow_never_ran"]);
  });

  it("stays quiet inside the limit", () => {
    expect(checkInvariants({ ...base, workflowAgeHours: { "Nightly learn": 47.9 } })).toEqual([]);
  });

  it("watches the crons, and leaves signal-engine to the dead-cron watchdog", () => {
    expect(SCHEDULED_WORKFLOWS).toContain("nightly-learn.yml");
    expect(SCHEDULED_WORKFLOWS).toContain("weekly-digest.yml");
    expect(SCHEDULED_WORKFLOWS).not.toContain("signal-engine.yml");
  });
});

describe("formatInvariantReport", () => {
  it("states the count and every violation", () => {
    const body = formatInvariantReport(
      [
        { code: "stat_empty_with_data", detail: "score_calibration is empty while 12 rows exist." },
        { code: "workflow_stale", detail: "Weekly digest last ran 73h ago." },
      ],
      "2026-07-25T06:00:00.000Z"
    );
    expect(body).toContain("2 violation(s)");
    expect(body).toContain("score_calibration");
    expect(body).toContain("Weekly digest");
    expect(body).toContain("closes itself");
  });
});
