import { describe, expect, it } from "vitest";
import { planStaleOpen, type ComputedOutcome } from "@/lib/engine/stale-open";

/* The two rows that stayed OPEN for seven weeks: ids 8793 (MES, suppressed) and
   8802 (MNQ), both entered 2026-08-18 06:15 UTC (epoch 1787033700). */
const MES = "B:rsi-reversion:MES:1787033700";
const MNQ = "B:rsi-reversion:MNQ:1787033700";
const AUG_18 = "2026-08-18T06:15:00.000Z";
// Run on 2026-10-03 with the 7-day mirror window.
const NOW = Date.parse("2026-10-03T15:00:00Z") / 1000;
const CUTOFF = NOW - 7 * 86400;

describe("planStaleOpen", () => {
  it("orphans the stranded Aug 18 rows the recompute no longer produces", () => {
    const plan = planStaleOpen(
      [
        { dedupe_key: MES, status: "triggered", signal_ts: AUG_18 },
        { dedupe_key: MNQ, status: "triggered", signal_ts: AUG_18 },
      ],
      CUTOFF,
      new Map()
    );
    expect(plan).toEqual({ close: [], orphan: [MES, MNQ] });
  });

  it("writes the recorded outcome when the recompute still holds a finished trade", () => {
    const outcome: ComputedOutcome = {
      status: "hit_target",
      exit_ts: "2026-08-18T07:40:00.000Z",
      exit_price: 29891.99,
      pnl_usd: 104.5,
    };
    const plan = planStaleOpen(
      [{ dedupe_key: MNQ, status: "triggered", signal_ts: AUG_18 }],
      CUTOFF,
      new Map([[MNQ, outcome]])
    );
    expect(plan).toEqual({ close: [{ key: MNQ, outcome }], orphan: [] });
  });

  it("never treats an unfinished computed trade as a close", () => {
    const plan = planStaleOpen(
      [{ dedupe_key: MNQ, status: "pending", signal_ts: AUG_18 }],
      CUTOFF,
      new Map([[MNQ, { status: "triggered", exit_ts: null, exit_price: null, pnl_usd: null }]])
    );
    expect(plan.orphan).toEqual([MNQ]);
  });

  it("leaves rows inside the mirror window to the normal upsert", () => {
    const recent = new Date((CUTOFF + 3600) * 1000).toISOString();
    const plan = planStaleOpen(
      [{ dedupe_key: "A:zone-v5:MES:1", status: "triggered", signal_ts: recent }],
      CUTOFF,
      new Map()
    );
    expect(plan).toEqual({ close: [], orphan: [] });
  });

  it("ignores rows that are already closed", () => {
    const plan = planStaleOpen(
      [{ dedupe_key: MES, status: "hit_stop", signal_ts: AUG_18 }],
      CUTOFF,
      new Map()
    );
    expect(plan).toEqual({ close: [], orphan: [] });
  });
});
