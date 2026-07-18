/* Golden parity: the TypeScript port of the v5 engine must produce byte-equal
   stacks and evaluation results to the legacy implementation on real data. */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import * as ported from "@/lib/strategies/zone-v5/engine";
import mesFixture from "@/tests/fixtures/bars-mes.json";
import mnqFixture from "@/tests/fixtures/bars-mnq.json";
import type { Bar } from "@/lib/types";

interface LegacyV5 {
  buildStack: (bars: Bar[]) => any;
  evaluate: (stack: any, opts: any) => any;
  intermarketCheck: (mine: any, other: any, sym: string, bars?: Bar[]) => any;
  planFromZone: (zone: any, symbol: string, config?: any) => any;
}

let legacy: LegacyV5;

beforeAll(() => {
  const require = createRequire(import.meta.url);
  require("./legacy/strategy.js"); // attaches AegisV5 to globalThis
  legacy = (globalThis as any).AegisV5;
  expect(legacy).toBeDefined();
});

const strip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe.each([
  ["MES", mesFixture.bars as Bar[]],
  ["MNQ", mnqFixture.bars as Bar[]],
])("zone-v5 parity on %s fixture", (symbol, bars) => {
  it("buildStack produces identical frames, zones and rejects", () => {
    const oldStack = legacy.buildStack(bars);
    const newStack = ported.buildStack(bars);
    expect(strip(newStack.frames)).toEqual(strip(oldStack.frames));
    expect(strip(newStack.zones)).toEqual(strip(oldStack.zones));
    expect(strip(newStack.rejects)).toEqual(strip(oldStack.rejects));
  });

  it("evaluate matches across a sweep of times and both modes", () => {
    const oldStack = legacy.buildStack(bars);
    const newStack = ported.buildStack(bars);
    const exec = newStack.exec;
    let checked = 0;
    for (let i = 20; i < exec.length; i += 7) {
      const bar = exec[i];
      for (const mode of ["strict", "directional"] as const) {
        const opts = { symbol, time: bar.time + 300, price: bar.close, mode };
        const oldEval = legacy.evaluate(oldStack, opts);
        const newEval = ported.evaluate(newStack, opts);
        // `achieved`, `opposing` and `trend` are additive TS-port fields
        // (weak-zone filter, zone target and odds-enhancer scoring); the
        // legacy oracle does not emit them.
        const { achieved: _achieved, opposing: _opposing, trend: _trend, ...newComparable } = newEval;
        expect(strip(newComparable)).toEqual(strip(oldEval));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("intermarket parity", () => {
  it("matches on a sweep across both markets", () => {
    const mesBars = mesFixture.bars as Bar[];
    const mnqBars = mnqFixture.bars as Bar[];
    const oldMes = legacy.buildStack(mesBars);
    const oldMnq = legacy.buildStack(mnqBars);
    const newMes = ported.buildStack(mesBars);
    const newMnq = ported.buildStack(mnqBars);
    const exec = newMes.exec;
    for (let i = 50; i < exec.length; i += 37) {
      const bar = exec[i];
      const t = bar.time + 300;
      const mnqVisible = (mnqFixture.bars as Bar[]).filter((b) => b.time + 300 <= t);
      if (!mnqVisible.length) continue;
      const opts = { time: t, mode: "strict" as const };
      const oldA = legacy.evaluate(oldMes, { ...opts, symbol: "MES", price: bar.close });
      const oldB = legacy.evaluate(oldMnq, {
        ...opts,
        symbol: "MNQ",
        price: mnqVisible[mnqVisible.length - 1].close,
      });
      const newA = ported.evaluate(newMes, { ...opts, symbol: "MES", price: bar.close });
      const newB = ported.evaluate(newMnq, {
        ...opts,
        symbol: "MNQ",
        price: mnqVisible[mnqVisible.length - 1].close,
      });
      const execSlice = exec.slice(Math.max(0, i - 6), i + 1);
      expect(strip(ported.intermarketCheck(newA, newB, "MNQ", execSlice))).toEqual(
        strip(legacy.intermarketCheck(oldA, oldB, "MNQ", execSlice))
      );
    }
  });
});
