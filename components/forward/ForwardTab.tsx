"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { runBacktestAsync } from "@/lib/backtest/client";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { ParamValues } from "@/lib/strategies/types";
import { strategyById } from "@/lib/strategies/registry";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { loadStored, saveStored, removeStored, KEYS } from "@/lib/data/storage";
import { money, pct, ts } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { Badge, Button, DataTable, Kpi, Panel } from "@/components/ui";
import type { ExecutionSettings } from "@/components/lab/ExecutionPanel";
import styles from "@/components/lab/lab.module.css";

/* Forward test = a deterministic replay anchored at the moment you arm it.
   Every refresh re-runs the unified engine from the anchor over the latest
   delayed 5-minute bars, so the state reconstructs itself after any reload
   from just {armedAt, strategy, params} in localStorage. */

interface ForwardState {
  armedAt: number; // unix sec anchor
  strategyId: string;
  params: ParamValues;
  execution: ExecutionSettings;
  armedAtIso: string;
}

interface LegacyAgentState {
  trades?: { symbol?: string; side?: string; pnl?: number; exitTime?: number }[];
  realizedPnl?: number;
}

export default function ForwardTab({
  strategyId,
  params,
  execution,
}: {
  strategyId: string;
  params: ParamValues;
  execution: ExecutionSettings;
}) {
  const data = useData();
  const [stored, setStored] = useState<ForwardState | null>(() =>
    loadStored<ForwardState>(KEYS.agent)
  );
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [evalNote, setEvalNote] = useState<string>("");
  const legacy = useMemo(() => loadStored<LegacyAgentState>(KEYS.legacyAgent), []);

  const feedsReady =
    data.history.MES.status === "ready" && data.history.MNQ.status === "ready";

  const lastBarTime = useMemo(() => {
    const times = (["MES", "MNQ"] as FeedSymbol[])
      .map((s) => data.history[s].bars.at(-1)?.time ?? 0)
      .filter(Boolean);
    return times.length ? Math.min(...times) : 0;
  }, [data.history]);

  const dataAgeMin = lastBarTime ? Math.round((Date.now() / 1000 - lastBarTime) / 60) : null;

  const arm = () => {
    const now = Math.floor(Date.now() / 1000);
    const st: ForwardState = {
      armedAt: now,
      strategyId,
      params,
      execution,
      armedAtIso: new Date().toISOString(),
    };
    saveStored(KEYS.agent, st);
    setStored(st);
    setResult(null);
  };

  const disarm = () => {
    removeStored(KEYS.agent);
    setStored(null);
    setResult(null);
  };

  const refresh = useCallback(async () => {
    if (!stored || !feedsReady) return;
    try {
      const strategy = strategyById(stored.strategyId);
      const wanted: FeedSymbol[] =
        strategy.symbolMode === "multi" ? ["MES", "MNQ"] : ["MES", "MNQ"];
      const series = Object.fromEntries(wanted.map((s) => [s, data.history[s].bars]));
      const res = await runBacktestAsync({
        strategyId: stored.strategyId,
        params: stored.params,
        series,
        execution: {
          cost: stored.execution.cost,
          slippage: stored.execution.slippage,
          maxRisk: stored.execution.maxRisk,
          sizing: "risk",
        },
        locks: stored.execution.locksEnabled
          ? {
              dailyLoss: stored.execution.dailyLoss,
              maxTrades: stored.execution.maxTrades,
              maxLosses: stored.execution.maxLosses,
              maxDrawdown: stored.execution.maxDrawdown,
            }
          : null,
        startingCapital: stored.execution.startingCapital,
        sessionExitMinute: 925,
        newsTimes: data.newsTimes,
        window: { fromTime: stored.armedAt },
        pointValues: Object.fromEntries(wanted.map((s) => [s, POINT_VALUES[s]])),
        keepOpenAtEnd: true,
      });
      setResult(res);
      setEvalNote(`evaluated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setEvalNote(`evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [stored, feedsReady, data.history, data.newsTimes]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      data.reloadHistory();
      refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh, data]);

  const strategy = strategyById(stored?.strategyId ?? strategyId);
  const m = result?.metrics;

  const checklist: { label: string; ok: boolean | null; detail: string }[] = [
    {
      label: "Delayed feed",
      ok: feedsReady ? (dataAgeMin !== null && dataAgeMin < 20 ? true : null) : false,
      detail: feedsReady
        ? `last completed bar ${dataAgeMin} min ago${dataAgeMin !== null && dataAgeMin >= 20 ? " — market likely closed or feed stale" : ""}`
        : "waiting for MES/MNQ history",
    },
    {
      label: "News lockout",
      ok: !data.newsTimes.some((t) => Math.abs(t - Date.now() / 1000) <= 1800),
      detail: "entries pause ±30 min around scheduled high-impact events",
    },
    {
      label: "Open position",
      ok: result?.openPosition ? null : true,
      detail: result?.openPosition
        ? `${result.openPosition.side} ${result.openPosition.qty} ${result.openPosition.symbol} @ ${result.openPosition.entry.toFixed(2)}`
        : "flat",
    },
  ];

  return (
    <div className={styles.resultsCol}>
      <Panel
        title="Forward test"
        hint="paper simulation on the delayed feed — no orders are ever sent"
        actions={
          stored ? (
            <Button small onClick={disarm}>
              Disarm & reset
            </Button>
          ) : undefined
        }
      >
        {!stored ? (
          <>
            <p className={styles.note}>
              Arm the currently selected strategy (<b>{strategy.name}</b>, with your Lab
              parameters) to paper-trade it forward from this moment. Progress is recomputed
              deterministically from the arm time on every refresh, so it survives reloads.
            </p>
            <Button variant="primary" onClick={arm} disabled={!feedsReady}>
              Arm forward test
            </Button>
          </>
        ) : (
          <>
            <p className={styles.note}>
              <Badge tone="green">ARMED</Badge> {strategy.name} since{" "}
              {ts(stored.armedAt)} · {evalNote || "evaluating…"}
            </p>
            <div className={styles.kpiGrid}>
              <Kpi
                label="Net P&L"
                value={m ? money(m.net) : "—"}
                tone={m && m.net > 0 ? "good" : m && m.net < 0 ? "bad" : "dim"}
                sub={m ? `${m.trades} closed trades` : undefined}
              />
              <Kpi label="Win rate" value={m && m.trades ? pct(m.winRate) : "—"} />
              <Kpi
                label="Open position"
                value={
                  result?.openPosition
                    ? `${result.openPosition.side} ${result.openPosition.qty} ${result.openPosition.symbol}`
                    : "FLAT"
                }
                sub={
                  result?.openPosition
                    ? `entry ${result.openPosition.entry.toFixed(2)} · stop ${result.openPosition.stop.toFixed(2)}${result.openPosition.target ? ` · target ${result.openPosition.target.toFixed(2)}` : ""}`
                    : undefined
                }
                tone={result?.openPosition ? "warn" : undefined}
              />
            </div>
          </>
        )}
      </Panel>

      <Panel title="Pipeline" hint="the same gates the backtest engine applies">
        <div className={styles.funnel}>
          {checklist.map((c) => (
            <div key={c.label} className={styles.funnelRow} style={{ gridTemplateColumns: "170px auto 1fr" }}>
              <span>{c.label}</span>
              <Badge tone={c.ok === true ? "green" : c.ok === false ? "red" : "amber"}>
                {c.ok === true ? "OK" : c.ok === false ? "BLOCKED" : "WATCH"}
              </Badge>
              <span style={{ color: "var(--text-faint)" }}>{c.detail}</span>
            </div>
          ))}
        </div>
      </Panel>

      {stored && (
        <Panel title="Closed forward trades">
          <DataTable
            columns={["Entry", "Exit", "Sym", "Side", "Qty", "P&L", "R", "Reason"]}
            rows={(result?.trades ?? []).map((t) => [
              ts(t.entryTime),
              ts(t.exitTime),
              t.symbol,
              t.side,
              t.qty,
              <span key="p" style={{ color: t.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                {money(t.pnl)}
              </span>,
              t.rMultiple.toFixed(2),
              t.exitReason,
            ])}
            empty="No forward trades yet — signals are scarce by design; the pipeline shows what the strategy is waiting for."
          />
        </Panel>
      )}

      {legacy?.trades?.length ? (
        <Panel title="Legacy paper-agent journal" hint="read-only archive from the previous app">
          <p className={styles.note}>
            {legacy.trades.length} trades, realized {money(legacy.realizedPnl ?? 0)}. The old
            agent filled at signal price; the new forward test uses next-bar-open fills, so
            results are not directly comparable.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
