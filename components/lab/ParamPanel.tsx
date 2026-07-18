"use client";

import { useState } from "react";
import type { ParamValues, Strategy } from "@/lib/strategies/types";
import { defaultParams } from "@/lib/strategies/types";
import { loadPresets, savePresets, type StrategyPreset } from "@/lib/data/storage";
import { Badge, Button, NumberField, Panel, SelectField, ToggleField } from "@/components/ui";
import styles from "./lab.module.css";

export default function ParamPanel({
  strategy,
  params,
  onChange,
}: {
  strategy: Strategy<unknown>;
  params: ParamValues;
  onChange: (p: ParamValues) => void;
}) {
  const [presets, setPresets] = useState<StrategyPreset[]>(() =>
    loadPresets().filter((p) => p.strategyId === strategy.id)
  );

  const set = (key: string, value: number | string | boolean) =>
    onChange({ ...params, [key]: value });

  const savePreset = () => {
    const name = window.prompt("Preset name?");
    if (!name) return;
    const all = loadPresets().filter(
      (p) => !(p.strategyId === strategy.id && p.name === name)
    );
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
      title="Parameters"
      actions={
        <Button variant="ghost" small onClick={() => onChange(defaultParams(strategy))}>
          Reset
        </Button>
      }
    >
      <div className={styles.paramGrid}>
        {strategy.params.map((def) => {
          if (def.type === "number")
            return (
              <NumberField
                key={def.key}
                label={def.label}
                value={Number(params[def.key] ?? def.default)}
                onChange={(v) => set(def.key, v)}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                help={def.help}
                slider
              />
            );
          if (def.type === "select")
            return (
              <SelectField
                key={def.key}
                label={def.label}
                value={String(params[def.key] ?? def.default)}
                onChange={(v) => set(def.key, v)}
                options={def.options}
                help={def.help}
              />
            );
          return (
            <ToggleField
              key={def.key}
              label={def.label}
              value={Boolean(params[def.key] ?? def.default)}
              onChange={(v) => set(def.key, v)}
              help={def.help}
            />
          );
        })}
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
      </div>
    </Panel>
  );
}
