import { describe, expect, it } from "vitest";
import {
  applyPreset,
  LAB_PRESETS,
  matchPreset,
  plainCopy,
  splitParams,
} from "@/lib/strategies/plain";
import { strategyById } from "@/lib/strategies/registry";
import { defaultParams } from "@/lib/strategies/types";

/* The Lab's named starting points and the plain-language front panel.

   The regression these pin: presets were first written as multipliers on each
   parameter's default. zone-v5's minScore, breakevenR and trailR all default to
   0, and any multiple of zero is zero — so "Fewer, bigger", whose whole promise
   is a stricter entry, silently moved nothing on the strictness knob and only
   changed the profit target. The nudge model exists to make that impossible. */

const zone = strategyById("zone-v5");
const preset = (id: string) => {
  const p = LAB_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};

describe("lab presets", () => {
  it("Balanced restores every numeric default exactly", () => {
    const tinkered = { ...defaultParams(zone), minScore: 55, targetNet: 300 };
    const out = applyPreset(zone, tinkered, preset("balanced"));
    for (const def of zone.params) {
      if (def.type !== "number") continue;
      expect(out[def.key], def.key).toBe(def.default);
    }
  });

  it("'Fewer, bigger' actually tightens the entry gate, not just the target", () => {
    const base = defaultParams(zone);
    const out = applyPreset(zone, base, preset("fewer"));
    // The bug: minScore defaults to 0, so a multiplier left it at 0.
    expect(Number(base.minScore)).toBe(0);
    expect(Number(out.minScore)).toBeGreaterThan(0);
    expect(Number(out.targetNet)).toBeGreaterThan(Number(base.targetNet));
  });

  it("'More trades' takes profit sooner", () => {
    const base = defaultParams(zone);
    const out = applyPreset(zone, base, preset("more"));
    expect(Number(out.targetNet)).toBeLessThan(Number(base.targetNet));
  });

  it("a nudge that would cross a bound stops at the bound", () => {
    // minScore already sits on its minimum, so "looser" has nowhere to go.
    const out = applyPreset(zone, defaultParams(zone), preset("more"));
    expect(Number(out.minScore)).toBe(0);
  });

  it("every preset stays inside every declared range", () => {
    for (const p of LAB_PRESETS) {
      const out = applyPreset(zone, defaultParams(zone), p);
      for (const def of zone.params) {
        if (def.type !== "number") continue;
        expect(Number(out[def.key]), `${p.id}/${def.key}`).toBeGreaterThanOrEqual(def.min);
        expect(Number(out[def.key]), `${p.id}/${def.key}`).toBeLessThanOrEqual(def.max);
      }
    }
  });

  it("presets never touch non-numeric parameters", () => {
    const base = defaultParams(zone);
    for (const p of LAB_PRESETS) {
      const out = applyPreset(zone, base, p);
      for (const def of zone.params) {
        if (def.type === "number") continue;
        expect(out[def.key], `${p.id}/${def.key}`).toBe(base[def.key]);
      }
    }
  });

  it("matchPreset recognises the defaults as Balanced and hand-tuning as neither", () => {
    expect(matchPreset(zone, defaultParams(zone))).toBe("balanced");
    const odd = { ...defaultParams(zone), targetNet: 137.5 };
    expect(matchPreset(zone, odd)).toBeNull();
  });

  it("applying a preset is idempotent", () => {
    const once = applyPreset(zone, defaultParams(zone), preset("fewer"));
    const twice = applyPreset(zone, once, preset("fewer"));
    expect(twice).toEqual(once);
  });

  it("a preset is a complete starting point, not a diff on what you had", () => {
    // Switching Fewer → More must not leave Fewer's breakevenR behind: each
    // pill is a named starting point and has to mean the same thing whatever
    // was on screen first.
    const fromDefaults = applyPreset(zone, defaultParams(zone), preset("more"));
    const afterFewer = applyPreset(
      zone,
      applyPreset(zone, defaultParams(zone), preset("fewer")),
      preset("more")
    );
    expect(afterFewer).toEqual(fromDefaults);

    const fromHandTuned = applyPreset(
      zone,
      { ...defaultParams(zone), breakevenR: 1.9, trailR: 2.5, minScore: 88 },
      preset("more")
    );
    expect(fromHandTuned).toEqual(fromDefaults);
  });
});

describe("plain-language parameter split", () => {
  it("zone-v5 puts six settings on the front panel and the rest in Advanced", () => {
    const { key, advanced } = splitParams(zone);
    expect(key).toHaveLength(6);
    expect(key.length + advanced.length).toBe(zone.params.length);
    // No parameter may appear in both halves, or vanish from both.
    const seen = new Set([...key, ...advanced].map((p) => p.key));
    expect(seen.size).toBe(zone.params.length);
  });

  it("every front-panel setting has plain-language copy, not the engine label", () => {
    const { key } = splitParams(zone);
    for (const def of key) {
      const copy = plainCopy(zone.id, def);
      expect(copy.name, def.key).not.toBe(def.label);
      expect(copy.hint.length, def.key).toBeGreaterThan(0);
    }
  });

  it("a strategy with no curated list still gets a usable split", () => {
    const other = strategyById("rsi-reversion");
    const { key, advanced } = splitParams(other);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length + advanced.length).toBe(other.params.length);
    expect(key.every((p) => p.type === "number")).toBe(true);
  });
});
