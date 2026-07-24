import { describe, expect, it } from "vitest";
import { fetchAllRows } from "../scripts/engine/paginate";
import { applyBreakers } from "../scripts/engine/breakers";

/* Finding 2: decision paths must not silently truncate at Supabase's 1000-row
   cap. fetchAllRows pages through everything; the breaker read takes the most
   recent rows via descending order + range. */

type Op = [string, ...unknown[]];
interface CallState {
  table: string;
  ops: Op[];
}

/* Minimal chainable, thenable Supabase mock. resolve(table, state) supplies the
   rows; every builder call is recorded for assertions. */
function makeSupabase(resolve: (table: string, state: CallState) => unknown[]) {
  const calls: CallState[] = [];
  const from = (table: string) => {
    const state: CallState = { table, ops: [] };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "not", "eq", "order", "range", "limit", "gte", "in"])
      b[m] = (...args: unknown[]) => (state.ops.push([m, ...args]), b);
    b.then = (onResolve: (v: { data: unknown[]; error: null }) => void) => {
      calls.push(state);
      onResolve({ data: resolve(table, state), error: null });
    };
    return b;
  };
  return { client: { from } as never, calls };
}

const rangeOf = (state: CallState) => state.ops.find((o) => o[0] === "range") as Op | undefined;

describe("fetchAllRows", () => {
  it("pages through more than 1000 rows without truncating", async () => {
    const ALL = Array.from({ length: 2500 }, (_, i) => ({ i }));
    const { client, calls } = makeSupabase((_t, state) => {
      const r = rangeOf(state)!;
      const [from, to] = [r[1] as number, r[2] as number];
      return ALL.slice(from, to + 1);
    });
    const rows = await fetchAllRows<{ i: number }>(client, "shadow_signals", "*");
    expect(rows.length).toBe(2500);
    expect(rows[0].i).toBe(0);
    expect(rows[2499].i).toBe(2499);
    // 2500 rows ⇒ pages [0..999], [1000..1999], [2000..2999] = 3 reads.
    expect(calls.length).toBe(3);
    expect(rangeOf(calls[0])).toEqual(["range", 0, 999]);
    expect(rangeOf(calls[2])).toEqual(["range", 2000, 2999]);
  });
});

describe("applyBreakers read path", () => {
  it("reads the most recent closed signals via descending order + range(0,199)", async () => {
    // Healthy stream (no pause), no policy history ⇒ no flip, no insert.
    const winners = Array.from({ length: 24 }, (_, i) => ({
      pnl_usd: i % 2 ? -40 : 100,
      fill_confidence: "clean",
      signal_ts: new Date((1_700_000_000 + i * 3600) * 1000).toISOString(),
    }));
    const { client, calls } = makeSupabase((table) => (table === "signals" ? winners : []));
    await applyBreakers(client, 1_700_000_000 + 60 * 86400);

    const signalReads = calls.filter((c) => c.table === "signals");
    expect(signalReads.length).toBeGreaterThan(0);
    for (const c of signalReads) {
      expect(c.ops).toContainEqual(["order", "signal_ts", { ascending: false }]);
      expect(rangeOf(c)).toEqual(["range", 0, 199]);
    }
  });
});
