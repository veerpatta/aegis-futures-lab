import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOSED_STATUSES,
  TARGETLESS_NOTE,
  isWinStatus,
  statusFromExit,
  targetlessStream,
} from "@/lib/signals/status";
import { promotionReport, type ShadowLike } from "../scripts/engine/promotion";
import { diffSignalAlerts } from "../scripts/engine/alerts";
import { SHADOW_STRATEGIES, RETIRED_SHADOW_STRATEGIES } from "../scripts/engine/shadow";

/* Item 2.2. A strategy whose exit style is `{kind: "signalOnly"}` has no price
   target, so tryOpen leaves position.target null and the target-hit branch can
   never fire. Every exit — including the profitable ones — used to be stamped
   "expired" and rendered FLAT CLOSE. Live evidence at the time of the fix: 2 of
   ema-cross's 28 rows and 1 of orb's were profitable exits labelled "expired". */

describe("statusFromExit (2.2a)", () => {
  it("keeps the bracket outcomes exactly as before", () => {
    expect(statusFromExit("target", 200)).toBe("hit_target");
    expect(statusFromExit("target", -5)).toBe("hit_target"); // reason wins, not sign
    expect(statusFromExit("stop", -150)).toBe("hit_stop");
    expect(statusFromExit("stop", 3)).toBe("hit_stop");
  });

  it("labels a profitable non-bracket exit a win, not an expiry", () => {
    for (const reason of ["signal", "session", "windowEnd"]) {
      expect(statusFromExit(reason, 181.8)).toBe("closed_win");
      expect(isWinStatus(statusFromExit(reason, 181.8))).toBe(true);
    }
  });

  it("still calls a flat or losing non-bracket exit an expiry", () => {
    for (const reason of ["signal", "session", "windowEnd"]) {
      expect(statusFromExit(reason, 0)).toBe("expired");
      expect(statusFromExit(reason, -42)).toBe("expired");
      expect(isWinStatus(statusFromExit(reason, -42))).toBe(false);
    }
  });

  it("treats closed_win as terminal, so it alerts and closes like any other exit", () => {
    expect(CLOSED_STATUSES.has("closed_win")).toBe(true);
    const closed = diffSignalAlerts(new Map([["k", "triggered"]]), [
      { dedupe_key: "k", tier: "B", symbol: "MES", direction: "long", entry_price: 1, stop_price: 0, target_price: null, rr: null, status: "closed_win", pnl_usd: 181.8, signal_ts: "2026-07-24T14:00:00.000Z" },
    ]);
    expect(closed.closed).toHaveLength(1);
    expect(closed.opened).toHaveLength(0);
  });
});

describe("targetlessStream + the scoreboard guard (2.2b)", () => {
  const row = (over: Partial<ShadowLike> = {}): ShadowLike => ({
    status: "expired",
    pnl_usd: -100,
    regime: "trend-low-vol",
    fill_confidence: "clean",
    target_price: null,
    ...over,
  });

  it("spots a stream where no row has a target", () => {
    expect(targetlessStream([{ target_price: null }, { target_price: null }])).toBe(true);
    expect(targetlessStream([{ target_price: null }, { target_price: 5 }])).toBe(false);
    expect(targetlessStream([])).toBe(false); // no rows is not a verdict
  });

  it("refuses to print a win rate for a targetless stream", () => {
    // ema-cross's real shape: 28 rows, 2 profitable, every target null.
    const rows = [
      ...Array.from({ length: 26 }, () => row()),
      row({ pnl_usd: 120 }),
      row({ pnl_usd: 60 }),
    ];
    const r = promotionReport(rows);
    expect(r.targetless).toBe(true);
    expect(r.winRate).toBeNull();
    expect(r.winRateNote).toBe(TARGETLESS_NOTE);
    expect(r.checklist.some((c) => c.label === TARGETLESS_NOTE && !c.pass)).toBe(true);
    // Money numbers stay real — only the incomparable ratio is withheld.
    expect(r.closed).toBe(28);
    expect(r.net).toBeCloseTo(-2420, 0);
  });

  it("still prints a win rate for a bracketed stream", () => {
    const rows = [
      row({ target_price: 10, pnl_usd: 100, status: "hit_target" }),
      row({ target_price: 10, pnl_usd: -50, status: "hit_stop" }),
    ];
    const r = promotionReport(rows);
    expect(r.targetless).toBe(false);
    expect(r.winRate).toBe(50);
    expect(r.winRateNote).toBeNull();
    expect(r.checklist.some((c) => c.label === TARGETLESS_NOTE)).toBe(false);
  });

  it("does not claim targetless when callers omit target_price entirely", () => {
    // Older callers select fewer columns; absent must not read as null.
    const legacy = [{ status: "hit_stop", pnl_usd: -20, regime: "range-low-vol", fill_confidence: "clean" }];
    const r = promotionReport(legacy);
    expect(r.targetless).toBe(false);
    expect(r.winRate).toBe(0);
  });
});

/* Regression guard for the mistake this round actually made: `closed_win` was
   introduced in code while both tables still had a CHECK constraint enumerating
   the old statuses, so the first engine run after the deploy failed on
   signals_status_check. Any future status must be added to the migration's
   enumeration in the SAME change that starts writing it. */
describe("every status the code can write is allowed by the schema", () => {
  const MIGRATION = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260725074509_winrate_round_closed_win_status.sql"
    ),
    "utf8"
  );

  it("the migration enumerates every value statusFromExit can produce", () => {
    const produced = new Set<string>();
    for (const reason of ["target", "stop", "signal", "session", "windowEnd"])
      for (const pnl of [100, 0, -100]) produced.add(statusFromExit(reason, pnl));
    expect(produced.size).toBeGreaterThanOrEqual(4);
    for (const status of produced) {
      expect(MIGRATION, `status '${status}' missing from the status CHECK constraint`).toContain(
        `'${status}'`
      );
    }
  });

  it("widens both tables, not just signals", () => {
    expect(MIGRATION).toContain("signals_status_check");
    expect(MIGRATION).toContain("shadow_signals_status_check");
  });

  it("keeps every pre-existing status valid — the change is widen-only", () => {
    for (const legacy of ["pending", "triggered", "hit_target", "hit_stop", "expired", "cancelled"])
      expect(MIGRATION).toContain(`'${legacy}'`);
  });
});

describe("ema-cross retirement (2.2c)", () => {
  it("is off the audition roster and recorded as retired", () => {
    expect(SHADOW_STRATEGIES).not.toContain("ema-cross");
    expect(RETIRED_SHADOW_STRATEGIES).toContain("ema-cross");
  });

  it("leaves the other three auditioning", () => {
    expect([...SHADOW_STRATEGIES].sort()).toEqual(["bollinger-breakout", "orb", "vwap-reversion"]);
  });
});
