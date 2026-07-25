/* Plain-trading-language names for the handful of settings that actually
   change how a strategy behaves.

   The native pass splits the Lab's parameter list into "the ones that matter"
   and an Advanced drawer, and re-words the front ones for a reader who knows
   trading but not the codebase. The engineering `label`/`help` on each
   ParamDef stays authoritative in the Advanced drawer — this is a friendlier
   surface over the same keys, never a different set of values.

   A strategy with no entry here falls back to its first KEY_FALLBACK numeric
   parameters, so a newly added strategy still gets a sensible split. */

import type { ParamDef, Strategy } from "./types";

export const KEY_FALLBACK = 6;

interface PlainCopy {
  name: string;
  hint: string;
}

/* Keyed by `${strategyId}:${paramKey}`. */
const PLAIN: Record<string, PlainCopy> = {
  "zone-v5:minScore": {
    name: "How sure before it trades",
    hint: "Higher = fewer but stronger ideas",
  },
  "zone-v5:targetNet": {
    name: "Profit target per trade",
    hint: "The net dollars a winner aims for, after costs",
  },
  "zone-v5:stopBuffer": {
    name: "Room beyond the zone",
    hint: "Extra points past the zone edge before the stop sits",
  },
  "zone-v5:breakevenR": {
    name: "Move the stop to breakeven at",
    hint: "0 = never. 1 = once the trade is up one times its risk",
  },
  "zone-v5:trailR": {
    name: "Trailing stop distance",
    hint: "0 = off. Otherwise the stop follows this far behind price",
  },
  "zone-v5:htfRange": {
    name: "How far a zone still counts",
    hint: "Bigger = a zone stays valid further from where it formed",
  },
};

/* The ordered key list a strategy puts on its front panel. */
const KEY_ORDER: Record<string, string[]> = {
  "zone-v5": ["minScore", "targetNet", "stopBuffer", "breakevenR", "trailR", "htfRange"],
};

export function plainCopy(strategyId: string, def: ParamDef): PlainCopy {
  return (
    PLAIN[`${strategyId}:${def.key}`] ?? {
      name: def.label,
      hint: def.help ?? "",
    }
  );
}

/** Split a strategy's parameters into the front panel and the Advanced drawer. */
export function splitParams(strategy: Strategy<unknown>): {
  key: ParamDef[];
  advanced: ParamDef[];
} {
  const order = KEY_ORDER[strategy.id];
  if (order) {
    const keySet = new Set(order);
    const key = order
      .map((k) => strategy.params.find((p) => p.key === k))
      .filter((p): p is ParamDef => p !== undefined);
    return { key, advanced: strategy.params.filter((p) => !keySet.has(p.key)) };
  }
  const numeric = strategy.params.filter((p) => p.type === "number").slice(0, KEY_FALLBACK);
  const keySet = new Set(numeric.map((p) => p.key));
  return { key: numeric, advanced: strategy.params.filter((p) => !keySet.has(p.key)) };
}

/* Named starting points, expressed as multipliers on the strategy's own
   defaults rather than hardcoded numbers — so they keep working if a default
   moves, and they can never claim a value outside a parameter's declared
   range. "Balanced" is always exactly the shipped defaults. */
export interface LabPreset {
  id: string;
  label: string;
  hint: string;
  /** Per-key multiplier applied to the default, clamped to [min, max]. */
  scale: Record<string, number>;
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    hint: "The shipped defaults, unchanged.",
    scale: {},
  },
  {
    id: "fewer",
    label: "Fewer, bigger",
    hint: "Demands a stronger setup and aims for a larger winner. Expect fewer trades.",
    scale: { minScore: 1.5, targetNet: 1.35 },
  },
  {
    id: "more",
    label: "More trades",
    hint: "Accepts weaker setups and takes profit sooner. Expect more trades and more noise.",
    scale: { minScore: 0.5, targetNet: 0.75 },
  },
];

/* Applying a preset never invents a value: an unlisted key keeps whatever the
   user already has, and a scaled key is clamped into its declared range. */
export function applyPreset(
  strategy: Strategy<unknown>,
  current: Record<string, number | string | boolean>,
  preset: LabPreset
): Record<string, number | string | boolean> {
  const out = { ...current };
  for (const def of strategy.params) {
    if (def.type !== "number") continue;
    const factor = preset.scale[def.key];
    if (factor === undefined) {
      if (preset.id === "balanced") out[def.key] = def.default;
      continue;
    }
    const min = def.min ?? 0;
    const max = def.max ?? Number.MAX_SAFE_INTEGER;
    const raw = Number(def.default) * factor;
    const stepped = def.step ? Math.round(raw / def.step) * def.step : raw;
    out[def.key] = Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
  }
  return out;
}

/** Which preset the current values correspond to, or null when hand-tuned. */
export function matchPreset(
  strategy: Strategy<unknown>,
  current: Record<string, number | string | boolean>
): string | null {
  for (const preset of LAB_PRESETS) {
    const target = applyPreset(strategy, current, preset);
    const same = strategy.params
      .filter((p) => p.type === "number")
      .every((p) => Number(current[p.key]) === Number(target[p.key]));
    if (same) return preset.id;
  }
  return null;
}
