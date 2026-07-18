"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STRATEGIES, strategyById } from "@/lib/strategies/registry";
import { defaultParams, type ParamValues } from "@/lib/strategies/types";
import { runBacktestAsync } from "@/lib/backtest/client";
import type { BacktestResult } from "@/lib/backtest/engine";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { money, pct, ratio } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { Button, DataTable, Panel, SelectField } from "@/components/ui";
import EquityChart from "@/components/chart/EquityChart";
import ParamFields from "@/components/lab/ParamFields";
import { DEFAULT_EXECUTION } from "@/components/lab/ExecutionPanel";
import styles from "./compare.module.css";

interface Slot {
  strategyId: string;
  label: string;
  params: ParamValues;
}

type SlotResult =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: BacktestResult }
  | { status: "error"; error: string };

const RAMP = [
  "var(--ramp-1)",
  "var(--ramp-2)",
  "var(--ramp-3)",
  "var(--ramp-4)",
  "var(--ramp-5)",
  "var(--ramp-6)",
];

function newSlot(strategyId: string, n: number): Slot {
  const s = strategyById(strategyId);
  return { strategyId, label: `Run ${n}: ${s.name}`, params: defaultParams(s) };
}

function defaultSlots(): Slot[] {
  // A meaningful default comparison: strict v5 vs the directional v4 study.
  const a = newSlot("zone-v5", 1);
  a.label = "Zone v5 · strict";
  const b = newSlot("zone-v5", 2);
  b.label = "Zone v5 · directional (v4)";
  b.params = { ...b.params, mode: "directional" };
  return [a, b];
}

function decodeSlots(encoded: string | null): Slot[] | null {
  if (!encoded) return null;
  try {
    const raw = JSON.parse(atob(encoded)) as { s: string; l: string; p: ParamValues }[];
    if (!Array.isArray(raw) || !raw.length) return null;
    return raw.slice(0, 6).map((r, i) => ({
      strategyId: STRATEGIES.some((x) => x.id === r.s) ? r.s : STRATEGIES[0].id,
      label: r.l || `Run ${i + 1}`,
      params: { ...defaultParams(strategyById(r.s)), ...(r.p || {}) },
    }));
  } catch {
    return null;
  }
}

export default function CompareClient() {
  const data = useData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [slots, setSlots] = useState<Slot[]>(
    () => decodeSlots(searchParams.get("runs")) ?? defaultSlots()
  );
  const [symbolChoice, setSymbolChoice] = useState<"both" | "MES" | "MNQ">(
    (searchParams.get("sym") as "both" | "MES" | "MNQ") || "both"
  );
  const [windowChoice, setWindowChoice] = useState<"30" | "40" | "60">(
    (searchParams.get("win") as "30" | "40" | "60") || "60"
  );
  const [results, setResults] = useState<SlotResult[]>(slots.map(() => ({ status: "idle" })));
  const [running, setRunning] = useState(false);

  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const q = new URLSearchParams();
      q.set(
        "runs",
        btoa(JSON.stringify(slots.map((s) => ({ s: s.strategyId, l: s.label, p: s.params }))))
      );
      if (symbolChoice !== "both") q.set("sym", symbolChoice);
      if (windowChoice !== "60") q.set("win", windowChoice);
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    }, 500);
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, [slots, symbolChoice, windowChoice, pathname, router]);

  const wanted: FeedSymbol[] = symbolChoice === "both" ? ["MES", "MNQ"] : [symbolChoice];
  const dataReady = wanted.every((s) => data.history[s].status === "ready");

  const updateSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const setSlotStrategy = (i: number, strategyId: string) => {
    const s = strategyById(strategyId);
    updateSlot(i, {
      strategyId,
      params: defaultParams(s),
      label: `Run ${i + 1}: ${s.name}`,
    });
  };

  const addSlot = (from?: Slot) =>
    setSlots((all) => {
      if (all.length >= 6) return all;
      const next = from
        ? { ...from, label: `${from.label} (copy)`, params: { ...from.params } }
        : newSlot(STRATEGIES[0].id, all.length + 1);
      return [...all, next];
    });

  const removeSlot = (i: number) => setSlots((all) => all.filter((_, j) => j !== i));

  const runAll = async () => {
    if (!dataReady) return;
    setRunning(true);
    const series = Object.fromEntries(wanted.map((s) => [s, data.history[s].bars]));
    const pointValues = Object.fromEntries(wanted.map((s) => [s, POINT_VALUES[s]]));
    const lastTimes = Object.values(series).map((b) => b[b.length - 1].time);
    const toTime = Math.min(...lastTimes);
    const window = { fromTime: toTime - Number(windowChoice) * 86400, toTime };
    setResults(slots.map(() => ({ status: "idle" })));
    for (let i = 0; i < slots.length; i++) {
      setResults((r) => r.map((x, j) => (j === i ? { status: "running" } : x)));
      try {
        const result = await runBacktestAsync({
          strategyId: slots[i].strategyId,
          params: slots[i].params,
          series,
          execution: {
            cost: DEFAULT_EXECUTION.cost,
            slippage: DEFAULT_EXECUTION.slippage,
            maxRisk: DEFAULT_EXECUTION.maxRisk,
            sizing: "risk",
          },
          locks: {
            dailyLoss: DEFAULT_EXECUTION.dailyLoss,
            maxTrades: DEFAULT_EXECUTION.maxTrades,
            maxLosses: DEFAULT_EXECUTION.maxLosses,
            maxDrawdown: DEFAULT_EXECUTION.maxDrawdown,
          },
          startingCapital: DEFAULT_EXECUTION.startingCapital,
          sessionExitMinute: 925,
          newsTimes: data.newsTimes,
          window,
          pointValues,
        });
        setResults((r) => r.map((x, j) => (j === i ? { status: "done", result } : x)));
      } catch (e) {
        setResults((r) =>
          r.map((x, j) =>
            j === i ? { status: "error", error: e instanceof Error ? e.message : String(e) } : x
          )
        );
      }
    }
    setRunning(false);
  };

  const done = useMemo(
    () =>
      results
        .map((r, i) => ({ r, i }))
        .filter((x): x is { r: { status: "done"; result: BacktestResult }; i: number } =>
          x.r.status === "done"
        ),
    [results]
  );

  const metricRows = useMemo(() => {
    if (!done.length) return [];
    const cols = done.map((d) => d.r.result.metrics);
    const defs: {
      label: string;
      value: (m: (typeof cols)[0]) => string;
      best: ((m: (typeof cols)[0]) => number) | null;
      dir: 1 | -1;
    }[] = [
      { label: "Net P&L", value: (m) => money(m.net), best: (m) => m.net, dir: 1 },
      { label: "Trades", value: (m) => String(m.trades), best: null, dir: 1 },
      { label: "Win rate", value: (m) => (m.trades ? pct(m.winRate) : "—"), best: (m) => m.winRate, dir: 1 },
      {
        label: "Profit factor",
        value: (m) => (m.trades ? ratio(m.profitFactor) : "—"),
        best: (m) => (Number.isFinite(m.profitFactor) ? m.profitFactor : 1e9),
        dir: 1,
      },
      { label: "Avg R", value: (m) => (m.trades ? m.avgR.toFixed(2) : "—"), best: (m) => m.avgR, dir: 1 },
      {
        label: "Max drawdown",
        value: (m) => money(-m.maxDrawdown, false),
        best: (m) => m.maxDrawdown,
        dir: -1,
      },
      {
        label: "Expectancy",
        value: (m) => (m.trades ? money(m.expectancy) : "—"),
        best: (m) => m.expectancy,
        dir: 1,
      },
      {
        label: "Avg duration",
        value: (m) => (m.trades ? `${Math.round(m.averageDuration)} min` : "—"),
        best: null,
        dir: 1,
      },
    ];
    return defs.map((def) => {
      let bestIdx = -1;
      if (def.best && cols.some((m) => m.trades > 0)) {
        const vals = cols.map(def.best);
        const target = def.dir === 1 ? Math.max(...vals) : Math.min(...vals);
        bestIdx = vals.indexOf(target);
      }
      return [
        def.label,
        ...cols.map((m, i) => (
          <span key={i} className={i === bestIdx ? styles.bestCell : undefined}>
            {def.value(m)}
          </span>
        )),
      ];
    });
  }, [done]);

  return (
    <>
      <h1 className="pageTitle">Compare</h1>
      <p className="pageSub">
        Run up to six strategies or parameter variants over the same data window and compare them
        apples-to-apples.
      </p>

      <div className={styles.slots}>
        {slots.map((slot, i) => (
          <Panel
            key={i}
            className={styles.slot}
            title={`Run ${i + 1}`}
            actions={
              <span style={{ display: "flex", gap: 4 }}>
                <Button small variant="ghost" onClick={() => addSlot(slot)} disabled={slots.length >= 6}>
                  Duplicate
                </Button>
                <Button small variant="ghost" onClick={() => removeSlot(i)} disabled={slots.length <= 2}>
                  Remove
                </Button>
              </span>
            }
          >
            <div style={{ ["--slot-color" as string]: RAMP[i] }}>
              <div className={styles.slotHead}>
                <SelectField
                  label="Strategy"
                  value={slot.strategyId}
                  onChange={(v) => setSlotStrategy(i, v)}
                  options={STRATEGIES.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <input
                className={styles.labelInput}
                value={slot.label}
                aria-label="Run label"
                onChange={(e) => updateSlot(i, { label: e.target.value })}
              />
              <div className={styles.slotParams}>
                <ParamFields
                  strategy={strategyById(slot.strategyId)}
                  params={slot.params}
                  onChange={(p) => updateSlot(i, { params: p })}
                  compact
                />
              </div>
              {results[i]?.status === "running" && <span className={styles.status}>Running…</span>}
              {results[i]?.status === "error" && (
                <span className={styles.status} style={{ color: "var(--red)" }}>
                  {(results[i] as { error: string }).error}
                </span>
              )}
            </div>
          </Panel>
        ))}
      </div>

      <div className={styles.runRow}>
        <SelectField
          label="Instruments (all runs)"
          value={symbolChoice}
          onChange={(v) => setSymbolChoice(v as "both" | "MES" | "MNQ")}
          options={[
            { value: "both", label: "MES + MNQ (portfolio)" },
            { value: "MES", label: "MES only" },
            { value: "MNQ", label: "MNQ only" },
          ]}
        />
        <SelectField
          label="Window (all runs)"
          value={windowChoice}
          onChange={(v) => setWindowChoice(v as "30" | "40" | "60")}
          options={[
            { value: "30", label: "Last 30 days" },
            { value: "40", label: "Last 40 days" },
            { value: "60", label: "Last 60 days" },
          ]}
        />
        <div className={styles.grow0}>
          <Button small onClick={() => addSlot()} disabled={slots.length >= 6}>
            + Add run
          </Button>
        </div>
        <div className={styles.grow0}>
          <Button variant="primary" onClick={runAll} disabled={!dataReady || running}>
            {running ? "Running…" : `Run all ${slots.length}`}
          </Button>
        </div>
      </div>
      {!dataReady && (
        <p className={styles.note}>Waiting for the delayed 60-day feed to load…</p>
      )}

      {done.length > 0 && (
        <div className={styles.results}>
          <Panel title="Equity curves" hint="same window, same execution settings">
            <EquityChart
              series={done.map(({ r, i }) => ({
                label: slots[i]?.label ?? `Run ${i + 1}`,
                color: RAMP[i],
                points: r.result.equityPoints,
              }))}
              baseline={DEFAULT_EXECUTION.startingCapital}
            />
          </Panel>
          <Panel title="Metrics" hint="best value per row highlighted">
            <DataTable
              mobileCards={{ titleIndexes: [0] }}
              columns={["Metric", ...done.map(({ i }) => slots[i]?.label ?? `Run ${i + 1}`)]}
              rows={metricRows}
            />
          </Panel>
        </div>
      )}
    </>
  );
}
