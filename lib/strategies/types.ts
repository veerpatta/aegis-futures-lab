import type { FrictionSpec } from "@/lib/costs/model";
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
  /* Running intra-trade excursion in POINTS from the entry price, both
     non-negative. Bookkeeping only — no strategy reads these and nothing in
     the engine branches on them, so they cannot move a trade (parity). The
     engine seeds them at 0 on open and folds every bar it manages. */
  maePoints?: number;
  mfePoints?: number;
  /* Bar times of the MAE/MFE extremes, and the entry-bar context needed to
     normalise them later. Same bookkeeping-only category as the two above:
     no strategy reads them and the engine never branches on them. */
  maeTime?: number;
  mfeTime?: number;
  /* The stop at entry, kept because `stop` is mutated by adjustStop and is
     therefore the wrong excursion denominator once a trade has trailed. */
  initialStop?: number;
  atrAtEntry?: number;
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
  /* Minimum entry-to-stop distance, in POINTS, below which a setup is not
     taken. DEFAULT 0 = off, which is the legacy behaviour the golden parity
     tests pin; switching it on is a per-stream config decision, not a change
     of default.

     Why it exists: risk sizing is maxRisk / (stopDistance × pointValue +
     cost), so as the stop distance approaches zero the contract count runs
     away. Phase 1 measured tier A sizing up to 55 contracts, which implies a
     stop roughly 0.1 points from entry — and, in its own words, "a 55-lot fill
     on a 0.1-point stop is not a trade anyone gets". Those trades inflate both
     the gross and net figures at the tail, in whichever direction they
     happened to resolve. This is the guard that brief asked for. */
  minStopPoints?: number;
  /* Time- and symbol-aware friction. ABSENT is the legacy path, which is what
     keeps the zone-v5 parity oracle green: with no spec the engine uses the
     flat `slippage` scalar on entry only, exactly as before.

     lib/costs/model.ts documented this contract — "every consumer in engine.ts
     checks friction !== undefined" — for a long time while engine.ts did not
     import from lib/costs at all and ExecutionConfig had no such field. So
     REALISTIC_MODEL was not "built and deliberately not adopted"; it was
     unreachable, and frictionSpecFor had no caller outside its own test. This
     field is what makes the claim true. */
  friction?: FrictionSpec;
  /* Make a "limit" fill model mean a genuinely RESTING order: placed on the
     bar the decision was made, eligible to fill only on LATER bars. DEFAULT
     false = the legacy same-bar fill the parity oracle pins.

     Legacy is same-bar look-ahead. The strategy emits a limit signal only
     after seeing that the bar ALREADY touched the zone, and the engine then
     fills inside that same bar, justified as "the order was resting before
     price arrived". It was not: the decision to rest an order is taken at the
     bar's CLOSE, and there is no persistent order — a bar that did not touch
     discards the signal entirely. So an order is only ever treated as having
     rested on the bars where it demonstrably filled.

     Turning this on makes results WORSE, which is the point: look-ahead
     flatters, and tier A already sits at the 0.0th percentile with it. */
  restingLimitOrders?: boolean;
}

export interface ReadoutRow {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "dim";
}

/* Called by strategies to explain why a snapshot produced no signal;
   the engine aggregates these into the skip-reason funnel. The optional
   symbol lets the engine attribute the note in per-day/event views. */
export type SkipNote = (reason: string, symbol?: string) => void;

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
