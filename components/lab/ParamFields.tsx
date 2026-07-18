"use client";

import type { ParamValues, Strategy } from "@/lib/strategies/types";
import { NumberField, SelectField, ToggleField } from "@/components/ui";

/* Renders a strategy's typed parameter definitions as controls. Shared by
   the Lab ParamPanel and the Compare slot editor. */
export default function ParamFields({
  strategy,
  params,
  onChange,
  compact,
}: {
  strategy: Strategy<unknown>;
  params: ParamValues;
  onChange: (p: ParamValues) => void;
  compact?: boolean;
}) {
  const set = (key: string, value: number | string | boolean) =>
    onChange({ ...params, [key]: value });
  return (
    <>
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
              help={compact ? undefined : def.help}
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
              help={compact ? undefined : def.help}
            />
          );
        return (
          <ToggleField
            key={def.key}
            label={def.label}
            value={Boolean(params[def.key] ?? def.default)}
            onChange={(v) => set(def.key, v)}
            help={compact ? undefined : def.help}
          />
        );
      })}
    </>
  );
}
