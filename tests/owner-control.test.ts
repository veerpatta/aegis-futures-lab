import { describe, expect, it } from "vitest";
import { decideOwnerControl } from "@/lib/experiment/owner-control";

const reason = "Owner requested this change";
const state = (status: "active" | "paused" | "stopped" | "locked", livePositions = 0) => ({ id: "learner-1", status, livePositions });
describe("virtual owner controls", () => {
  it("permits only the matching pause, resume and stop transitions", () => {
    expect(decideOwnerControl("pause", reason, "learner-1", state("active"))).toEqual({ kind: "status", to: "paused" });
    expect(decideOwnerControl("resume", reason, "learner-1", state("paused"))).toEqual({ kind: "status", to: "active" });
    expect(decideOwnerControl("stop", reason, "learner-1", state("locked"))).toEqual({ kind: "status", to: "stopped" });
    expect(() => decideOwnerControl("resume", reason, "learner-1", state("locked"))).toThrow();
    expect(() => decideOwnerControl("pause", reason, "learner-1", state("stopped"))).toThrow();
  });
  it("refuses stale commands, weak reasons and a new campaign while positions remain", () => {
    expect(() => decideOwnerControl("pause", reason, "old", state("active"))).toThrow(/changed/);
    expect(() => decideOwnerControl("stop", "short", "learner-1", state("active"))).toThrow(/reason/);
    expect(() => decideOwnerControl("start", reason, "learner-1", state("stopped", 1))).toThrow(/settled/);
    expect(() => decideOwnerControl("stop", reason, "learner-1", state("paused", 1))).toThrow(/settled/);
    expect(() => decideOwnerControl("start", reason, "learner-1", state("active"))).toThrow(/Stop/);
    expect(decideOwnerControl("start", reason, "learner-1", state("stopped"))).toEqual({ kind: "new_campaign" });
    expect(decideOwnerControl("start", reason, null, null)).toEqual({ kind: "new_campaign" });
  });
});
