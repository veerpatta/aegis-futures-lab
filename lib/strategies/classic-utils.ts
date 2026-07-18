import type { Bar } from "@/lib/types";
import type { Snapshot } from "./types";

/* Helpers shared by the indicator-based strategies. Each classic strategy
   precomputes per-symbol arrays in prepare(); onSnapshot only reads values
   at the visible index, so the walk stays look-ahead-free. */

export interface SymbolView {
  symbol: string;
  bars: Bar[];
  index: number;
  bar: Bar;
}

export function visibleSymbols(snap: Snapshot): SymbolView[] {
  const out: SymbolView[] = [];
  for (const [symbol, vis] of Object.entries(snap.bySymbol)) {
    if (!vis) continue;
    out.push({ symbol, bars: vis.bars, index: vis.index, bar: vis.bars[vis.index] });
  }
  return out;
}

export function crossedUp(
  a: (number | null)[],
  b: (number | null)[],
  i: number
): boolean {
  const a0 = a[i - 1],
    a1 = a[i],
    b0 = b[i - 1],
    b1 = b[i];
  return a0 !== null && a1 !== null && b0 !== null && b1 !== null && a0 <= b0 && a1 > b1;
}

export function crossedDown(
  a: (number | null)[],
  b: (number | null)[],
  i: number
): boolean {
  const a0 = a[i - 1],
    a1 = a[i],
    b0 = b[i - 1],
    b1 = b[i];
  return a0 !== null && a1 !== null && b0 !== null && b1 !== null && a0 >= b0 && a1 < b1;
}

export function num(v: number | string | boolean | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
