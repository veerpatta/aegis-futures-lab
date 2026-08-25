"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runBacktestAsync } from "@/lib/backtest/client";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { ParamValues } from "@/lib/strategies/types";
import { strategyById, feedsFor, tradableFeedsFor } from "@/lib/strategies/registry";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { loadStored, saveStored, removeStored, KEYS } from "@/lib/data/storage";
import { useStoredState, useStoredValue } from "@/lib/data/useStored";
import { money, pct, ts } from "@/lib/format";
import { rateReadout } from "@/lib/stats";
import { useData } from "@/components/providers/DataProvider";
import { clockIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
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
  const { zone } = useZone();
  /* the evaluation callback stamps a time without depending on the zone */
  const zoneRef = useRef(zone);
  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);
  /* Both hydrated on mount rather than during render — see
     lib/data/useStored.ts. Read in the render pass, any user with a saved
     forward run hydrated to different HTML than was prerendered. */
  const [stored, setStored] = useStoredState<ForwardState | null>(
    () => loadStored<ForwardState>(KEYS.agent),
    null
  );
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [evalNote, setEvalNote] = useState<string>("");
  const legacy = useStoredValue<LegacyAgentState | null>(
    () => loadStored<LegacyAgentState>(KEYS.legacyAgent),
    null
  );
  const strategy = strategyById(stored?.strategyId ?? strategyId);
  const wantedFeeds = useMemo(() => feedsFor(strategy), [strategy]);

  useEffect(() => {
    data.ensureHistory(wantedFeeds);
  }, [data.ensureHistory, wantedFeeds]);

  const feedsReady = wantedFeeds.every((symbol) => data.history[symbol].status === "ready");

  const lastBarTime = useMemo(() => {
    const times = wantedFeeds
      .map((s) => data.history[s].bars.at(-1)?.time ?? 0)
      .filter(Boolean);
    return times.length ? Math.min(...times) : 0;
  }, [data.history, wantedFeeds]);

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
      /* Ask the strategy. Both arms of the ternary this replaces returned the
         same hardcoded pair, so a gold strategy was handed S&P and Nasdaq bars
         and silently produced nothing. */
      const wanted: FeedSymbol[] = feedsFor(strategy);
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
          tradableSymbols: tradableFeedsFor(strategy),
          fillModel: stored.execution.limitFills !== false ? "limit" : "nextOpen", // default limit for pre-upgrade stored runs
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
      setEvalNote(`evaluated ${clockIn(Math.floor(Date.now() / 1000), zoneRef.current)} ${ZONE_ABBR[zoneRef.current]}`);
    } catch (e) {
      setEvalNote(`evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [stored, feedsReady, data.history, data.newsTimes]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      data.reloadHistory();
      void refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh, data.reloadHistory]);

  const m = result?.metrics;

  const checklist: { label: string; ok: boolean | null; detail: string }[] = [
    {
      label: "Delayed feed",
      ok: feedsReady ? (dataAgeMin !== null && dataAgeMin < 20 ? true : null) : false,
      detail: feedsReady
        ? `last completed bar ${dataAgeMin} min ago${dataAgeMin !== null && dataAgeMin >= 20 ? " — market likely closed or feed stale" : ""}`
        : `waiting for ${wantedFeeds.join("/")} history`,
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
              {ts(stored.armedAt, zone)} · {evalNote || "evaluating…"}
            </p>
            <div className={styles.kpiGrid}>
              <Kpi
                label="Net P&L"
                value={m ? money(m.net) : "—"}
                tone={m && m.net > 0 ? "good" : m && m.net < 0 ? "bad" : "dim"}
                sub={m ? `${m.trades} closed trades` : undefined}
              />
              <Kpi
                label="Win rate"
                value={m && m.trades ? pct(m.winRate) : "—"}
                n={m?.trades ?? 0}
                ci={m ? rateReadout(m.wins, m.trades).ciLabel : null}
              />
              <Kpi
                label="Expectancy / trade"
                value={m && m.trades ? money(m.expectancy) : "—"}
                tone={m && m.trades ? (m.expectancy >= 0 ? "good" : "bad") : "dim"}
                n={m?.trades ?? 0}
              />
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
            <div key={c.label} className={styles.pipelineRow}>
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
            mobileCards={{ titleIndexes: [0, 3, 5] }}
            columns={["Entry", "Exit", "Sym", "Side", "Qty", "P&L", "R", "Reason"]}
            rows={(result?.trades ?? []).map((t) => [
              ts(t.entryTime, zone),
              ts(t.exitTime, zone),
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
