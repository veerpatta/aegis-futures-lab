import type { Bar } from "@/lib/types";

/* The strategy contract: heavy precompute happens once in prepare(); after
   that onSnapshot() must be a pure function of the visible bars and the
   timestamp, so the engine can walk any window without look-ahead. */

export type ParamDef =
  | {
      key: string;
      label: string;
      type: "number";
      default: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
      help?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      default: string;
      options: { value: string; label: string }[];
      help?: string;
    }
  | { key: string; label: string; type: "boolean"; default: boolean; help?: string };

export type ParamValues = Record<string, number | string | boolean>;

export interface Snapshot {
  time: number; // union-timeline timestamp (bar open time)
  bySymbol: Record<string, { bars: Bar[]; index: number } | undefined>;
}

export type TargetSpec =
  | { kind: "price"; price: number }
  | { kind: "rMultiple"; r: number }
  | { kind: "netDollar"; amount: number }
  | { kind: "signalOnly" };

export interface EntrySignal {
  symbol: string;
  side: "LONG" | "SHORT";
  stop: number; // structural stop price — the engine sizes off this
  target: TargetSpec;
  /* Resting limit price (e.g. the zone proximal). With execution.fillModel
     "limit" the engine fills at this price on the touch bar itself — the
     order was resting before price arrived — instead of chasing the next
     bar's open. Ignored in "nextOpen" mode (legacy parity). */
  limit?: number;
  score?: number;
  tags?: Record<string, string>;
  rank?: number; // candidate priority when several symbols signal at once
}

export interface OpenPosition {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  stop: number;
  target: number | null;
  risk: number;
  openedAt: number;
  score?: number;
  tags?: Record<string, string>;
}

export interface ExecutionConfig {
  cost: number; // $ per contract, round trip
  slippage: number; // points added to fills
  maxRisk: number; // $ risk cap per trade (risk sizing)
  sizing: "risk" | "fixed";
  fixedQty?: number;
  /* "limit" fills signals that carry a limit price at that price on the
     signal bar (realistic for resting zone orders); "nextOpen" (default)
     keeps the legacy next-bar-open market fill. */
  fillModel?: "nextOpen" | "limit";
}

export interface ReadoutRow {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "dim";
}

/* Called by strategies to explain why a snapshot produced no signal;
   the engine aggregates these into the skip-reason funnel. */
export type SkipNote = (reason: string) => void;

export interface Strategy<Ctx = unknown> {
  id: string;
  name: string;
  blurb: string; // plain-English rules shown on the gallery card
  flagship?: boolean;
  symbolMode: "single" | "multi";
  params: ParamDef[];
  prepare(series: Record<string, Bar[]>, params: ParamValues, execution: ExecutionConfig): Ctx;
  onSnapshot(ctx: Ctx, snap: Snapshot, params: ParamValues, note: SkipNote): EntrySignal[];
  shouldExit?(ctx: Ctx, snap: Snapshot, position: OpenPosition, params: ParamValues): boolean;
  /* Optional trade management (e.g. breakeven): return a new stop price to
     tighten the stop, or null to leave it. The engine only ever tightens —
     a returned stop that widens risk is ignored. Called on each bar before
     the stop/target checks; must only use completed-bar information. */
  adjustStop?(ctx: Ctx, snap: Snapshot, position: OpenPosition, params: ParamValues): number | null;
  liveReadout?(ctx: Ctx, snap: Snapshot, params: ParamValues): ReadoutRow[];
}

export function defaultParams(strategy: Strategy<unknown>): ParamValues {
  const out: ParamValues = {};
  for (const p of strategy.params) out[p.key] = p.default;
  return out;
}
