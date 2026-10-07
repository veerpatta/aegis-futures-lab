import { describe, expect, it } from "vitest";
import { shouldRunPaperBroker } from "@/lib/engine/broker-gate";
import { formatTrialMessage } from "@/scripts/engine/alerts";
import { componentWarning, failedComponents } from "@/lib/engine/markers";

const sec = (iso: string) => Date.parse(iso) / 1000;
const bars = (lastIso: string) => [{ time: sec(lastIso) - 300 }, { time: sec(lastIso) }];

describe("paper broker gate", () => {
  it("runs whenever both markets have a fresh bar", () => {
    const now = sec("2026-10-05T19:00:00Z"); // 15:00 ET Monday
    expect(shouldRunPaperBroker({ MES: bars("2026-10-05T18:50:00Z"), MNQ: bars("2026-10-05T18:50:00Z") }, now)).toBe(true);
  });

  it("skips the daily 17:00–18:00 ET halt instead of letting the broker pause a release", () => {
    const now = sec("2026-10-05T21:45:00Z"); // 17:45 ET, newest bar 16:55 ET
    expect(shouldRunPaperBroker({ MES: bars("2026-10-05T20:55:00Z"), MNQ: bars("2026-10-05T20:55:00Z") }, now)).toBe(false);
  });

  it("skips the Sunday reopen, when Friday's bars are the newest", () => {
    const now = sec("2026-10-04T22:15:00Z"); // Sunday 18:15 ET
    expect(shouldRunPaperBroker({ MES: bars("2026-10-02T20:55:00Z"), MNQ: bars("2026-10-02T20:55:00Z") }, now)).toBe(false);
  });

  it("still runs on a stale feed inside the entry window, so the broker's own pause applies", () => {
    const now = sec("2026-10-05T15:00:00Z"); // 11:00 ET
    expect(shouldRunPaperBroker({ MES: bars("2026-10-05T13:00:00Z"), MNQ: bars("2026-10-05T14:55:00Z") }, now)).toBe(true);
  });

  it("treats a missing market as stale", () => {
    const now = sec("2026-10-05T21:45:00Z");
    expect(shouldRunPaperBroker({ MES: bars("2026-10-05T21:40:00Z") }, now)).toBe(false);
  });
});

describe("trial account alerts and markers", () => {
  it("says nothing when the trial did nothing", () => {
    expect(formatTrialMessage({ opened: [], closed: [], equity: 10000, locked: false })).toBeNull();
  });

  it("labels every message as practice money, not proven", () => {
    const msg = formatTrialMessage({
      opened: [{ symbol: "MNQ", side: "SHORT", qty: 1, entry: 31166.88, risk: 106.24, pnl: null }],
      closed: [{ symbol: "MES", side: "LONG", qty: 2, entry: 6000, risk: 150, pnl: -42.5 }],
      equity: 9957.5, locked: false,
    })!;
    expect(msg).toContain("practice money, not proven");
    expect(msg).toContain("Trial took 1 MNQ SHORT @ 31166.88");
    expect(msg).toContain("−$43");
    expect(msg).toContain("Balance $9957.50");
  });

  it("reports a trial-broker failure as its own component", () => {
    expect(failedComponents(componentWarning("trial-broker", "boom"))).toEqual(["trial-broker"]);
  });
});
