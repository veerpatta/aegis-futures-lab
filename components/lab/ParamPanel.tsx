"use client";

/* The Lab's settings panel.

   The native pass splits it in two: a short front panel of the settings that
   actually change behaviour, worded in trading language and shown as sliders,
   and an Advanced drawer holding everything else with its engineering label
   and help text intact. Named starting points sit above both.

   Nothing here changes a default — a preset is a set of values the reader
   chooses to apply, and "Balanced" restores the shipped defaults exactly. */

import { useState } from "react";
import type { ParamDef, ParamValues, Strategy } from "@/lib/strategies/types";
import { defaultParams } from "@/lib/strategies/types";
import {
  applyPreset,
  LAB_PRESETS,
  matchPreset,
  plainCopy,
  splitParams,
} from "@/lib/strategies/plain";
import { loadPresets, savePresets, type StrategyPreset } from "@/lib/data/storage";
import { useStoredState } from "@/lib/data/useStored";
import { Badge, Button, Panel } from "@/components/ui";
import ParamFields from "./ParamFields";
import styles from "./lab.module.css";

/* A single plain-language slider: name, current value, track, one-line hint. */
function PlainSlider({
  strategyId,
  def,
  value,
  onChange,
}: {
  strategyId: string;
  def: ParamDef;
  value: number;
  onChange: (v: number) => void;
}) {
  if (def.type !== "number") return null;
  const copy = plainCopy(strategyId, def);
  const pct = ((value - def.min) / (def.max - def.min || 1)) * 100;
  return (
    <div className={styles.knob}>
      <div className={styles.knobHead}>
        <label htmlFor={`knob-${def.key}`} className={styles.knobName}>
          {copy.name}
        </label>
        <b className={styles.knobVal}>
          {value}
          {def.unit ? ` ${def.unit}` : ""}
        </b>
      </div>
      <div className={styles.knobTrack}>
        <i className={styles.knobFill} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input
          id={`knob-${def.key}`}
          type="range"
          className={styles.knobInput}
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {copy.hint && <span className={styles.knobHint}>{copy.hint}</span>}
    </div>
  );
}

export default function ParamPanel({
  strategy,
  params,
  onChange,
}: {
  strategy: Strategy<unknown>;
  params: ParamValues;
  onChange: (p: ParamValues) => void;
}) {
  /* Hydrated on mount, not during render — see lib/data/useStored.ts. Read in
     the render pass, a user with saved presets got different HTML from the
     prerender and React discarded the tree. */
  const [presets, setPresets] = useStoredState<StrategyPreset[]>(
    () => loadPresets().filter((p) => p.strategyId === strategy.id),
    []
  );

  const { key, advanced } = splitParams(strategy);
  const activePreset = matchPreset(strategy, params);

  const savePreset = () => {
    const name = window.prompt("Preset name?");
    if (!name) return;
    const all = loadPresets().filter((p) => !(p.strategyId === strategy.id && p.name === name));
    const preset: StrategyPreset = {
      id: `${strategy.id}:${name}`,
      strategyId: strategy.id,
      name,
      params,
      savedAt: Date.now(),
    };
    savePresets([...all, preset]);
    setPresets([...all.filter((p) => p.strategyId === strategy.id), preset]);
  };

  const removePreset = (id: string) => {
    const all = loadPresets().filter((p) => p.id !== id);
    savePresets(all);
    setPresets(all.filter((p) => p.strategyId === strategy.id));
  };

  return (
    <Panel
      title={key.length ? `The ${key.length} that matter` : "Parameters"}
      actions={
        <Button variant="ghost" small onClick={() => onChange(defaultParams(strategy))}>
          Reset
        </Button>
      }
    >
      {/* Named starting points. */}
      <div className={styles.presetPills} role="group" aria-label="Starting point">
        {LAB_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === activePreset ? `${styles.pill} ${styles.pillOn}` : styles.pill}
            aria-pressed={p.id === activePreset}
            title={p.hint}
            onClick={() => onChange(applyPreset(strategy, params, p))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.knobs}>
        {key.map((def) =>
          def.type === "number" ? (
            <PlainSlider
              key={def.key}
              strategyId={strategy.id}
              def={def}
              value={Number(params[def.key] ?? def.default)}
              onChange={(v) => onChange({ ...params, [def.key]: v })}
            />
          ) : null
        )}
      </div>

      {advanced.length > 0 && (
        <details className={styles.advanced}>
          <summary>
            {advanced.length} more setting{advanced.length === 1 ? "" : "s"} in Advanced — with the
            engine&rsquo;s own wording
          </summary>
          <div className={styles.paramGrid}>
            <ParamFields
              strategy={{ ...strategy, params: advanced }}
              params={params}
              onChange={onChange}
            />
          </div>
        </details>
      )}

      <div className={styles.presetRow}>
        <Button small onClick={savePreset}>
          Save preset
        </Button>
        {presets.map((p) => (
          <span key={p.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <Button small variant="ghost" onClick={() => onChange({ ...p.params })}>
              <Badge tone="blue">{p.name}</Badge>
            </Button>
            <Button
              small
              variant="ghost"
              aria-label={`Delete preset ${p.name}`}
              onClick={() => removePreset(p.id)}
            >
              ×
            </Button>
          </span>
        ))}
      </div>
    </Panel>
  );
}
