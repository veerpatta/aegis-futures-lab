import { describe, expect, it } from "vitest";
import { COMPONENT_FAILED, componentWarning, failedComponents } from "@/lib/engine/markers";
import { COMPONENT_FAILED as WATCHDOG_TOKEN, findComponentFailures } from "../scripts/engine/watchdog.mjs";

describe("component failure markers", () => {
  it("the watchdog's copy of the token matches the engine's", () => {
    expect(WATCHDOG_TOKEN).toBe(COMPONENT_FAILED);
  });

  it("formats and parses a heartbeat warning", () => {
    const message = [
      "bars MES 13629 / MNQ 13625",
      componentWarning("research-observer", new Error("timeout; retry later")),
      componentWarning("paper-broker", "lock held"),
      componentWarning("research-observer", "again"),
    ].join("; ");
    expect(failedComponents(message)).toEqual(["research-observer", "paper-broker"]);
    expect(failedComponents("bars MES 1 / MNQ 1; age MES 3m / MNQ 3m")).toEqual([]);
    expect(failedComponents(null)).toEqual([]);
  });

  it("ignores an unknown component name", () => {
    expect(failedComponents(`${COMPONENT_FAILED}[made-up]: x`)).toEqual([]);
  });
});

describe("watchdog findComponentFailures", () => {
  const run = (...components: string[]) => ({
    status: "ok",
    message: ["bars ok", ...components.map((c) => `${COMPONENT_FAILED}[${c}]: boom`)].join("; "),
  });

  it("fires only for a component that failed on both of the newest runs", () => {
    expect(findComponentFailures([run("paper-broker", "excursion"), run("paper-broker")])).toEqual(["paper-broker"]);
  });

  it("stays quiet on a single blip", () => {
    expect(findComponentFailures([run("paper-broker"), run()])).toEqual([]);
    expect(findComponentFailures([run(), run("paper-broker")])).toEqual([]);
  });

  it("needs two runs to judge", () => {
    expect(findComponentFailures([run("paper-broker")])).toEqual([]);
  });

  it("an errored run carries no markers, so a dead engine is not a component alert", () => {
    expect(findComponentFailures([{ status: "error", message: "boom" }, run("paper-broker")])).toEqual([]);
  });
});
