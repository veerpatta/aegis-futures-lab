"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STRATEGIES, strategyById } from "@/lib/strategies/registry";
import { defaultParams, type ParamValues } from "@/lib/strategies/types";
import { runBacktestAsync } from "@/lib/backtest/client";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { RunRequest } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { decodeParams, encodeParams } from "@/lib/urlparams";
import type { Bar } from "@/lib/types";
import { useData } from "@/components/providers/DataProvider";
import { Badge, Button, Panel, SelectField, Tabs } from "@/components/ui";
import ParamPanel from "./ParamPanel";
import ExecutionPanel, { DEFAULT_EXECUTION, type ExecutionSettings } from "./ExecutionPanel";
import ResultsPanel from "./ResultsPanel";
import RiskCalculator from "./RiskCalculator";
import ForwardTab from "@/components/forward/ForwardTab";
import styles from "./lab.module.css";

type SymbolChoice = "both" | "MES" | "MNQ" | "csv";
type WindowChoice = "30" | "40" | "60" | "full";

export default function LabClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const data = useData();

  const initialStrategy = (() => {
    const s = searchParams.get("s");
    return s && STRATEGIES.some((x) => x.id === s) ? s : STRATEGIES[0].id;
  })();

  const [tab, setTab] = useState("backtest");
  const [strategyId, setStrategyId] = useState(initialStrategy);
  const strategy = useMemo(() => strategyById(strategyId), [strategyId]);
  const defaults = useMemo(() => defaultParams(strategy), [strategy]);
  const [params, setParams] = useState<ParamValues>(() =>
    decodeParams(searchParams.get("p"), defaults)
  );
  const [symbolChoice, setSymbolChoice] = useState<SymbolChoice>(
    (searchParams.get("sym") as SymbolChoice) || "both"
  );
  const [windowChoice, setWindowChoice] = useState<WindowChoice>(
    (searchParams.get("win") as WindowChoice) || "60"
  );
  const [execution, setExecution] = useState<ExecutionSettings>(DEFAULT_EXECUTION);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [resultSeries, setResultSeries] = useState<Record<string, Bar[]>>({});
  const [lastReq, setLastReq] = useState<RunRequest | null>(null);

  // Reflect the shareable bits into the URL (debounced replace).
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const q = new URLSearchParams();
      if (strategyId !== STRATEGIES[0].id) q.set("s", strategyId);
      const p = encodeParams(params, defaults);
      if (p) q.set("p", p);
      if (symbolChoice !== "both") q.set("sym", symbolChoice);
      if (windowChoice !== "60") q.set("win", windowChoice);
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 400);
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, [strategyId, params, symbolChoice, windowChoice, defaults, pathname, router]);

  const pickStrategy = (id: string) => {
    setStrategyId(id);
    setParams(defaultParams(strategyById(id)));
    setResult(null);
    setError(null);
  };

  const feedReady = (s: FeedSymbol) => data.history[s].status === "ready";
  const seriesForChoice = useCallback((): {
    series: Record<string, Bar[]>;
    pointValues: Record<string, number>;
    isLive: boolean;
  } | null => {
    if (symbolChoice === "csv") {
      if (!data.imported) return null;
      return {
        series: { [data.imported.label]: data.imported.bars },
        pointValues: { [data.imported.label]: data.imported.pointValue },
        isLive: false,
      };
    }
    const wanted: FeedSymbol[] = symbolChoice === "both" ? ["MES", "MNQ"] : [symbolChoice];
    if (!wanted.every(feedReady)) return null;
    return {
      series: Object.fromEntries(wanted.map((s) => [s, data.history[s].bars])),
      pointValues: Object.fromEntries(wanted.map((s) => [s, POINT_VALUES[s]])),
      isLive: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolChoice, data.history, data.imported]);

  const run = async () => {
    const picked = seriesForChoice();
    if (!picked) return;
    setRunning(true);
    setError(null);
    try {
      const lastTimes = Object.values(picked.series).map((b) => b[b.length - 1].time);
      const toTime = Math.min(...lastTimes);
      const window =
        windowChoice === "full"
          ? undefined
          : { fromTime: toTime - Number(windowChoice) * 86400, toTime };
      const req: RunRequest = {
        strategyId,
        params,
        series: picked.series,
        execution: {
          cost: execution.cost,
          slippage: execution.slippage,
          maxRisk: execution.maxRisk,
          sizing: "risk",
          fillModel: execution.limitFills ? "limit" : "nextOpen",
        },
        locks: execution.locksEnabled
          ? {
              dailyLoss: execution.dailyLoss,
              maxTrades: execution.maxTrades,
              maxLosses: execution.maxLosses,
              maxDrawdown: execution.maxDrawdown,
            }
          : null,
        startingCapital: execution.startingCapital,
        sessionExitMinute: 925,
        newsTimes: picked.isLive ? data.newsTimes : [],
        window,
        pointValues: picked.pointValues,
      };
      const res = await runBacktestAsync(req);
      setResult(res);
      setResultSeries(picked.series);
      setLastReq(req);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const dataReady = seriesForChoice() !== null;
  const feedNote =
    symbolChoice === "csv"
      ? data.imported
        ? `${data.imported.bars.length.toLocaleString()} imported bars`
        : "No CSV imported yet — load one on the Data page"
      : (["MES", "MNQ"] as FeedSymbol[])
          .filter((s) => symbolChoice === "both" || symbolChoice === s)
          .map((s) => {
            const st = data.history[s];
            return `${s}: ${st.status === "ready" ? `${st.bars.length.toLocaleString()} bars` : st.status === "error" ? `feed error` : "loading…"}`;
          })
          .join(" · ");

  const windowLabel =
    windowChoice === "full" ? "full imported range" : `last ${windowChoice} days · NY session 5m`;

  return (
    <>
      <h1 className="pageTitle">Lab</h1>
      <p className="pageSub">
        Pick a strategy, tune it, and see how it would have performed. Delayed data, paper
        simulation only — execution is permanently locked.
      </p>

      <div className={styles.gallery} role="list">
        {STRATEGIES.map((s) => (
          <button
            key={s.id}
            role="listitem"
            className={s.id === strategyId ? styles.cardActive : styles.card}
            onClick={() => pickStrategy(s.id)}
          >
            <span className={styles.cardHead}>
              <span className={styles.cardName}>{s.name}</span>
              {s.flagship && <Badge tone="green">FLAGSHIP</Badge>}
            </span>
            <span className={styles.cardBlurb}>{s.blurb}</span>
          </button>
        ))}
      </div>

      <Tabs
        tabs={[
          { id: "backtest", label: "Backtest" },
          { id: "forward", label: "Forward test" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "forward" ? (
        <ForwardTab strategyId={strategyId} params={params} execution={execution} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.configCol}>
            <ParamPanel strategy={strategy} params={params} onChange={setParams} />
            <ExecutionPanel value={execution} onChange={setExecution} />
            <RiskCalculator />
          </div>
          <div className={styles.resultsCol}>
            <Panel title="Data & run">
              <div className={styles.runBar}>
                <SelectField
                  label="Instruments"
                  value={symbolChoice}
                  onChange={(v) => setSymbolChoice(v as SymbolChoice)}
                  options={[
                    { value: "both", label: "MES + MNQ (portfolio)" },
                    { value: "MES", label: "MES only" },
                    { value: "MNQ", label: "MNQ only" },
                    { value: "csv", label: "Imported CSV", disabled: !data.imported },
                  ]}
                />
                <SelectField
                  label="Window"
                  value={windowChoice}
                  onChange={(v) => setWindowChoice(v as WindowChoice)}
                  options={[
                    { value: "30", label: "Last 30 days" },
                    { value: "40", label: "Last 40 days" },
                    { value: "60", label: "Last 60 days" },
                    ...(symbolChoice === "csv" ? [{ value: "full", label: "Full range" }] : []),
                  ]}
                />
                <div className={styles.runBtnWrap}>
                  <Button variant="primary" onClick={run} disabled={!dataReady || running}>
                    {running ? "Running…" : "Run backtest"}
                  </Button>
                </div>
              </div>
              <p className={styles.note} style={{ marginBottom: 0 }}>
                {feedNote}
                {strategy.symbolMode === "multi" && symbolChoice !== "both" && (
                  <>
                    {" "}
                    · single-series run: intermarket confirmation is skipped for {strategy.name}.
                  </>
                )}
              </p>
              {error && <div className={styles.error}>{error}</div>}
            </Panel>

            {result ? (
              <ResultsPanel
                result={result}
                series={resultSeries}
                rampColor="var(--ramp-1)"
                windowLabel={windowLabel}
                runRequest={lastReq ?? undefined}
              />
            ) : (
              <Panel title="Results">
                <span className={styles.note}>
                  Run a backtest to see net P&L, win rate, profit factor, the equity curve, the
                  qualification funnel, trades on the chart and the full ledger.
                </span>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}
