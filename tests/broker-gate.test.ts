import { describe, expect, it } from "vitest";
import { shouldRunPaperBroker } from "@/lib/engine/broker-gate";
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

describe("component markers", () => {
  it("reports a paper-broker failure as its own component", () => {
    expect(failedComponents(componentWarning("paper-broker", "boom"))).toEqual(["paper-broker"]);
  });
});
