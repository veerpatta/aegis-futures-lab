/** Validates owner commands against a freshly locked virtual campaign.
 * This module does not authenticate callers or write data; the command
 * processor must do both in its transaction before applying this decision. */
import type { ExperimentStatus } from "./types";

export type OwnerAction = "pause" | "resume" | "stop" | "start";
export type OwnerSnapshot = { id: string; status: ExperimentStatus; livePositions: number } | null;
export type ControlDecision = { kind: "status"; to: "active" | "paused" | "stopped" } | { kind: "new_campaign" };

export function decideOwnerControl(action: OwnerAction, reason: string, expectedId: string | null, current: OwnerSnapshot): ControlDecision {
  if (typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 500) throw new Error("Give a reason between 8 and 500 characters.");
  if ((current?.id ?? null) !== expectedId) throw new Error("Campaign changed; refresh before trying again.");
  if (current && (!Number.isSafeInteger(current.livePositions) || current.livePositions < 0)) throw new Error("Position state is unavailable.");
  switch (action) {
    case "pause":
      if (current?.status !== "active") throw new Error("Only an active campaign can be paused.");
      return { kind: "status", to: "paused" };
    case "resume":
      if (current?.status !== "paused") throw new Error("Only a paused campaign can be resumed.");
      return { kind: "status", to: "active" };
    case "stop":
      if (!current || (current.status !== "active" && current.status !== "paused" && current.status !== "locked")) throw new Error("This campaign cannot be stopped.");
      if (current.livePositions !== 0) throw new Error("Wait until all existing virtual positions are settled before stopping.");
      return { kind: "status", to: "stopped" };
    case "start":
      if (current && current.status !== "stopped" && current.status !== "locked") throw new Error("Stop the current campaign before starting another.");
      if (current && current.livePositions !== 0) throw new Error("Wait until all existing virtual positions are settled before starting another campaign.");
      return { kind: "new_campaign" };
    default: throw new Error("Unknown action.");
  }
}
