"use client";

import { NumberField, Panel, ToggleField } from "@/components/ui";
import styles from "./lab.module.css";

export interface ExecutionSettings {
  cost: number;
  slippage: number;
  maxRisk: number;
  startingCapital: number;
  locksEnabled: boolean;
  dailyLoss: number;
  maxTrades: number;
  maxLosses: number;
  maxDrawdown: number;
  limitFills: boolean; // fill at the zone's resting limit on the touch bar (realistic)
}

export const DEFAULT_EXECUTION: ExecutionSettings = {
  cost: 2.4,
  slippage: 0.25,
  maxRisk: 160,
  startingCapital: 2000,
  locksEnabled: true,
  dailyLoss: 320,
  maxTrades: 3,
  maxLosses: 2,
  maxDrawdown: 400,
  limitFills: true,
};

export default function ExecutionPanel({
  value,
  onChange,
}: {
  value: ExecutionSettings;
  onChange: (v: ExecutionSettings) => void;
}) {
  const set = <K extends keyof ExecutionSettings>(k: K, v: ExecutionSettings[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <Panel title="Execution & discipline" hint="shared by every strategy">
      <div className={styles.execGrid}>
        <NumberField
          label="Cost / contract RT"
          value={value.cost}
          onChange={(v) => set("cost", v)}
          min={0}
          max={20}
          step={0.1}
          unit="$"
        />
        <NumberField
          label="Slippage"
          value={value.slippage}
          onChange={(v) => set("slippage", v)}
          min={0}
          max={2}
          step={0.25}
          unit="pt"
        />
        <NumberField
          label="Max risk / trade"
          value={value.maxRisk}
          onChange={(v) => set("maxRisk", v)}
          min={20}
          max={1000}
          step={10}
          unit="$"
        />
        <NumberField
          label="Starting capital"
          value={value.startingCapital}
          onChange={(v) => set("startingCapital", v)}
          min={500}
          max={100000}
          step={100}
          unit="$"
        />
      </div>
      <div style={{ marginTop: "var(--space-3)" }}>
        <ToggleField
          label="Limit fills at the zone price (matches the live plan; off = legacy next-open fills)"
          value={value.limitFills}
          onChange={(v) => set("limitFills", v)}
        />
      </div>
      <div style={{ marginTop: "var(--space-3)" }}>
        <ToggleField
          label="Discipline locks (daily loss, trade count, streak, drawdown)"
          value={value.locksEnabled}
          onChange={(v) => set("locksEnabled", v)}
        />
      </div>
      {value.locksEnabled && (
        <div className={styles.execGrid} style={{ marginTop: "var(--space-3)" }}>
          <NumberField
            label="Daily loss stop"
            value={value.dailyLoss}
            onChange={(v) => set("dailyLoss", v)}
            min={50}
            max={5000}
            step={10}
            unit="$"
          />
          <NumberField
            label="Max trades / day"
            value={value.maxTrades}
            onChange={(v) => set("maxTrades", v)}
            min={1}
            max={20}
            step={1}
          />
          <NumberField
            label="Max consecutive losses"
            value={value.maxLosses}
            onChange={(v) => set("maxLosses", v)}
            min={1}
            max={10}
            step={1}
          />
          <NumberField
            label="Max drawdown"
            value={value.maxDrawdown}
            onChange={(v) => set("maxDrawdown", v)}
            min={100}
            max={10000}
            step={50}
            unit="$"
          />
        </div>
      )}
    </Panel>
  );
}
