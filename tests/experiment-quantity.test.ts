import { expect, it } from "vitest";
import { decisionLine } from "@/lib/plain/experiment";

it("describes actual fills, requests and cancellations without calling an unfilled order a trade", () => {
  const d = { action: "take", reason: "taken", qty: 2, position_status: "open", net: null };
  const line = (over = {}) => decisionLine({ ...d, ...over }, (s) => s, (n) => `$${n}`);
  expect(line()).toBe("Learner · took 2 contracts · open");
  expect(line({ position_status: "pending_fill" })).toContain("requested 2 contracts · waiting");
  expect(line({ position_status: "cancelled" })).toBe("Learner · order not filled");
});
