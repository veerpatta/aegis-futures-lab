import { describe, expect, it } from "vitest";
import { isLiveOpen, isStaleOpen, SESSION_FLAT_MINUTE } from "@/lib/signals/open-state";
import { signalSnapshot } from "@/lib/signals/snapshot";
import { SESSION_EXIT_MINUTE } from "@/scripts/engine/tiers";
import type { SignalRow } from "@/lib/neon/client";

const sec = (iso: string) => Date.parse(iso) / 1000;

describe("open-state guard", () => {
  it("mirrors the engine's flatten minute", () => {
    expect(SESSION_FLAT_MINUTE).toBe(SESSION_EXIT_MINUTE);
  });

  it("marks the Aug 18 row stale seven weeks later", () => {
    const row = { status: "triggered", signal_ts: "2026-08-18T06:15:00.000Z" };
    expect(isStaleOpen(row, sec("2026-10-03T15:00:00Z"))).toBe(true);
    expect(isLiveOpen(row, sec("2026-10-03T15:00:00Z"))).toBe(false);
  });

  it("keeps a same-session entry open until 90 minutes after 15:25 ET", () => {
    // 2026-08-18 is EDT: 15:25 ET = 19:25 UTC; +90 min = 20:55 UTC.
    const row = { status: "triggered", signal_ts: "2026-08-18T14:00:00.000Z" };
    expect(isStaleOpen(row, sec("2026-08-18T20:54:00Z"))).toBe(false);
    expect(isStaleOpen(row, sec("2026-08-18T20:56:00Z"))).toBe(true);
  });

  it("treats a Globex-evening entry as part of the next session", () => {
    // 20:00 ET on Monday 2026-08-17 belongs to Tuesday's session.
    const row = { status: "pending", signal_ts: "2026-08-18T00:00:00.000Z" };
    expect(isStaleOpen(row, sec("2026-08-18T13:00:00Z"))).toBe(false);
  });

  it("never touches a closed row", () => {
    expect(isStaleOpen({ status: "hit_target", signal_ts: "2026-08-18T06:15:00Z" }, sec("2026-10-03T15:00:00Z"))).toBe(false);
  });

  it("keeps a stale row out of the Home open count", () => {
    const row = (v: Partial<SignalRow>) =>
      ({ id: 1, signal_ts: "2026-09-25T13:00:00Z", status: "triggered", pnl_usd: null, exit_ts: null, ...v }) as SignalRow;
    const snap = signalSnapshot(
      [row({ id: 1, signal_ts: "2026-09-24T13:00:00Z" }), row({ id: 2 })],
      sec("2026-09-25T16:00:00Z")
    );
    expect(snap.open).toBe(1);
  });
});
