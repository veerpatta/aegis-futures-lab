"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { runBacktestAsync } from "@/lib/backtest/client";
import type { BacktestResult } from "@/lib/backtest/engine";
import type { RunRequest } from "@/lib/backtest/run";
import { strategyById } from "@/lib/strategies/registry";
import { defaultParams } from "@/lib/strategies/types";
import { decodeParams } from "@/lib/urlparams";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { loadJournal, type JournalStore } from "@/lib/journal";
import { matchAll, summarize } from "@/lib/journal/match";
import { nyDateKey } from "@/lib/time/ny";
import { money } from "@/lib/format";
import type { Bar } from "@/lib/types";
import { useData } from "@/components/providers/DataProvider";
import { DEFAULT_EXECUTION } from "@/components/lab/ExecutionPanel";
import CandleChart, { type PriceLine, type TradeMarker } from "@/components/chart/CandleChart";
import { Badge, Button, DataTable, Kpi, Panel, SelectField } from "@/components/ui";
import BlotterCalendar, { type BlotterDay } from "./BlotterCalendar";
import DayTimeline from "./DayTimeline";
import JournalPanel from "./JournalPanel";
import styles from "./replay.module.css";

/* Replay: one engine pass over the full 60-day delayed window (with the
   decision-event log enabled), a blotter calendar as day-picker, the day's
   chart with engine AND journal trades, the decision timeline, and the
   journal itself. Zone Engine v5 with its shipped defaults; a ?p= override
   from the Lab's share URL is honored. */

const STRATEGY_ID = "zone-v5";

export default function ReplayClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const data = useData();

  const strategy = useMemo(() => strategyById(STRATEGY_ID), []);
  const params = useMemo(
    () => decodeParams(searchParams.get("p"), defaultParams(strategy)),
    // Decode once per mount — replay is not a tuning surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const feedsReady =
    data.history.MES.status === "ready" && data.history.MNQ.status === "ready";
  const feedError = (["MES", "MNQ"] as FeedSymbol[]).find(
    (s) => data.history[s].status === "error"
  );

  const [run, setRun] = useState<{ result: BacktestResult; series: Record<string, Bar[]> } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const executeReplay = useCallback(async () => {
    if (!feedsReady || runningRef.current) return;
    runningRef.current = true;
    try {
      const wanted: FeedSymbol[] = ["MES", "MNQ"];
      const series = Object.fromEntries(wanted.map((s) => [s, data.history[s].bars]));
      const req: RunRequest = {
        strategyId: STRATEGY_ID,
        params,
        series,
        execution: {
          cost: DEFAULT_EXECUTION.cost,
          slippage: DEFAULT_EXECUTION.slippage,
          maxRisk: DEFAULT_EXECUTION.maxRisk,
          sizing: "risk",
          fillModel: DEFAULT_EXECUTION.limitFills ? "limit" : "nextOpen",
        },
        locks: DEFAULT_EXECUTION.locksEnabled
          ? {
              dailyLoss: DEFAULT_EXECUTION.dailyLoss,
              maxTrades: DEFAULT_EXECUTION.maxTrades,
              maxLosses: DEFAULT_EXECUTION.maxLosses,
              maxDrawdown: DEFAULT_EXECUTION.maxDrawdown,
            }
          : null,
        startingCapital: DEFAULT_EXECUTION.startingCapital,
        sessionExitMinute: 925,
        newsTimes: data.newsTimes,
        pointValues: Object.fromEntries(wanted.map((s) => [s, POINT_VALUES[s]])),
        collectEvents: true,
      };
      const result = await runBacktestAsync(req);
      setRun({ result, series });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      runningRef.current = false;
    }
  }, [feedsReady, data.history, data.newsTimes, params]);

  useEffect(() => {
    void executeReplay();
  }, [executeReplay]);

  // Journal: start empty (SSR-safe), hydrate from localStorage on mount.
  const [journal, setJournal] = useState<JournalStore>({ version: 1, trades: [] });
  useEffect(() => setJournal(loadJournal()), []);

  // All NY weekdays present in the bar data, ascending.
  const days = useMemo(() => {
    const bars = run?.series.MES ?? run?.series.MNQ ?? [];
    const seen = new Set<string>();
    for (const b of bars) seen.add(nyDateKey(b.time));
    return [...seen].sort();
  }, [run]);

  const urlDay = searchParams.get("d");
  const selectedDay = urlDay && days.includes(urlDay) ? urlDay : (days.at(-1) ?? null);

  const selectDay = (d: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set("d", d);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const matchByDay = useMemo(
    () => (run ? matchAll(run.result.trades, journal.trades, run.result.events) : {}),
    [run, journal]
  );

  const blotterDays = useMemo<BlotterDay[]>(() => {
    const engine = new Map<string, { n: number; pnl: number }>();
    for (const t of run?.result.trades ?? []) {
      const d = nyDateKey(t.entryTime);
      const cur = engine.get(d) ?? { n: 0, pnl: 0 };
      cur.n++;
      cur.pnl += t.pnl;
      engine.set(d, cur);
    }
    const user = new Map<string, number>();
    for (const t of journal.trades) {
      const d = nyDateKey(t.entryTime);
      user.set(d, (user.get(d) ?? 0) + 1);
    }
    return days.map((date) => ({
      date,
      engineTrades: engine.get(date)?.n ?? 0,
      enginePnl: engine.get(date)?.pnl ?? 0,
      userTrades: user.get(date) ?? 0,
    }));
  }, [days, run, journal]);

  const [chartSymbol, setChartSymbol] = useState<FeedSymbol>("MES");

  const dayBars = useMemo(
    () => (run?.series[chartSymbol] ?? []).filter((b) => nyDateKey(b.time) === selectedDay),
    [run, chartSymbol, selectedDay]
  );

  const dayEngineTrades = useMemo(
    () => (run?.result.trades ?? []).filter((t) => nyDateKey(t.entryTime) === selectedDay),
    [run, selectedDay]
  );
  const dayUserTrades = useMemo(
    () => journal.trades.filter((t) => nyDateKey(t.entryTime) === selectedDay),
    [journal, selectedDay]
  );
  const dayEvents = useMemo(
    () => (run?.result.events ?? []).filter((e) => e.date === selectedDay),
    [run, selectedDay]
  );
  const dayRows = (selectedDay && matchByDay[selectedDay]) || [];

  const markers = useMemo<TradeMarker[]>(() => {
    const out: TradeMarker[] = [];
    for (const t of dayEngineTrades) {
      if (t.symbol !== chartSymbol) continue;
      out.push({
        time: t.entryTime,
        kind: t.side === "LONG" ? "entryLong" : "entryShort",
        text: `${t.side} ${t.qty}`,
      });
      out.push({ time: t.exitTime, kind: "exit", text: money(t.pnl) });
    }
    for (const t of dayUserTrades) {
      if (t.symbol !== chartSymbol) continue;
      out.push({
        time: t.entryTime,
        kind: t.side === "LONG" ? "userEntryLong" : "userEntryShort",
        text: `you ${t.side === "LONG" ? "▲" : "▼"}`,
      });
      out.push({ time: t.exitTime, kind: "userExit" });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [dayEngineTrades, dayUserTrades, chartSymbol]);

  const lines = useMemo<PriceLine[]>(() => {
    const out: PriceLine[] = [];
    for (const t of dayEngineTrades) {
      if (t.symbol !== chartSymbol) continue;
      out.push({ price: t.entryPrice, color: "#5aa7ff", title: "entry" });
      out.push({ price: t.stop, color: "#ff6b7a", title: "stop", dashed: true });
      if (t.target !== null)
        out.push({ price: t.target, color: "#2dd4a0", title: "target", dashed: true });
    }
    return out;
  }, [dayEngineTrades, chartSymbol]);

  const dayEngineNet = dayEngineTrades.reduce((s, t) => s + t.pnl, 0);
  const daySummary = summarize(dayRows);

  // Journal-period summary: engine vs you over the days you actually traded.
  const journalSummary = useMemo(() => {
    if (!journal.trades.length || !run) return null;
    const journalDays = journal.trades.map((t) => nyDateKey(t.entryTime));
    const from = journalDays.reduce((a, b) => (a < b ? a : b));
    const to = journalDays.reduce((a, b) => (a > b ? a : b));
    const rows = Object.entries(matchByDay)
      .filter(([d]) => d >= from && d <= to)
      .flatMap(([, r]) => r);
    return { from, to, summary: summarize(rows) };
  }, [journal, run, matchByDay]);

  const loading = !run && !error && !feedError;

  return (
    <>
      <h1 className="pageTitle">Journal</h1>
      <p className="pageSub">
        Pick a past day and see exactly what the engine did — and would have told you — next to
        your own trades. Delayed data, paper simulation only.
      </p>

      {feedError && (
        <Panel title="Feed error">
          <div className={styles.error}>
            {feedError}: {data.history[feedError].error} ·{" "}
            <Button small onClick={data.reloadHistory}>
              Retry
            </Button>
          </div>
        </Panel>
      )}
      {error && (
        <Panel title="Replay error">
          <div className={styles.error}>{error}</div>
        </Panel>
      )}
      {loading && (
        <Panel title="Loading">
          <span className={styles.note}>
            Loading 60 days of delayed 5-minute bars and replaying the engine…
          </span>
        </Panel>
      )}

      {run && selectedDay && (
        <>
          <Panel
            title="Blotter"
            hint="engine trades per day · amber underline = your journal · click a day"
          >
            <BlotterCalendar days={blotterDays} selected={selectedDay} onSelect={selectDay} />
            {run.result.trades.length === 0 && (
              <p className={styles.note} style={{ marginTop: "var(--space-3)" }}>
                The engine took no trades in this whole window with the current settings — a real
                drought, not a bug. The zone rules on delayed 5-minute data produce ~0.1–0.3 trades
                per session at best; use the Lab&apos;s &quot;What if I relax one gate?&quot; table
                to see which filter is holding trades back and at what cost.
              </p>
            )}
          </Panel>

          <Panel title={`Day: ${selectedDay}`} hint="engine vs you">
            <div className={styles.kpiRow}>
              <Kpi
                label="Engine"
                value={`${dayEngineTrades.length} trade${dayEngineTrades.length === 1 ? "" : "s"}`}
                sub={dayEngineTrades.length ? money(dayEngineNet) : "no entries"}
                tone={dayEngineNet > 0 ? "good" : dayEngineNet < 0 ? "bad" : "dim"}
              />
              <Kpi
                label="You"
                value={`${dayUserTrades.length} trade${dayUserTrades.length === 1 ? "" : "s"}`}
                sub={dayUserTrades.length ? `${money(daySummary.userGross)} gross` : "journal empty"}
                tone={
                  daySummary.userGross > 0 ? "good" : daySummary.userGross < 0 ? "bad" : "dim"
                }
              />
              <Kpi label="Matched" value={String(daySummary.matched)} sub="engine took it too" />
              <Kpi
                label="Divergence"
                value={`${daySummary.missedByYou} / ${daySummary.engineSkipped}`}
                sub="missed by you / engine skipped"
              />
            </div>
          </Panel>

          <Panel
            title="Chart"
            hint="engine = green/red arrows & blue exits · yours = amber"
            actions={
              <div style={{ width: 110 }}>
                <SelectField
                  label=""
                  value={chartSymbol}
                  onChange={(v) => setChartSymbol(v as FeedSymbol)}
                  options={[
                    { value: "MES", label: "MES" },
                    { value: "MNQ", label: "MNQ" },
                  ]}
                />
              </div>
            }
          >
            {dayBars.length ? (
              <CandleChart bars={dayBars} markers={markers} lines={lines} height={320} />
            ) : (
              <span className={styles.note}>No bars for this day.</span>
            )}
          </Panel>

          <Panel title="Decision timeline" hint={`what the engine saw on ${selectedDay} (ET)`}>
            <DayTimeline
              events={dayEvents}
              trades={dayEngineTrades}
              rows={dayRows}
              symbol={chartSymbol}
            />
          </Panel>

          <JournalPanel selectedDay={selectedDay} journal={journal} onChange={setJournal} />

          {journalSummary && (
            <Panel
              title="Engine vs you — journal period"
              hint={`${journalSummary.from} → ${journalSummary.to}`}
            >
              <div className={styles.kpiRow}>
                <Kpi
                  label="Engine net"
                  value={money(journalSummary.summary.engineNet)}
                  tone={journalSummary.summary.engineNet >= 0 ? "good" : "bad"}
                  sub="costs included"
                />
                <Kpi
                  label="Your gross"
                  value={money(journalSummary.summary.userGross)}
                  tone={journalSummary.summary.userGross >= 0 ? "good" : "bad"}
                  sub="before commissions"
                />
                <Kpi label="Matched" value={String(journalSummary.summary.matched)} />
                <Kpi
                  label="Missed by you"
                  value={String(journalSummary.summary.missedByYou)}
                  sub="engine trades you didn't take"
                />
                <Kpi
                  label="Engine skipped"
                  value={String(journalSummary.summary.engineSkipped)}
                  sub="your trades it filtered out"
                />
              </div>
              <div style={{ marginTop: "var(--space-3)" }}>
                <DataTable
                  mobileCards={{ titleIndexes: [0, 1, 2] }}
                  columns={["Day", "Engine", "You (gross)", "Matched", "Missed", "Skipped"]}
                  rows={Object.entries(matchByDay)
                    .filter(([d]) => d >= journalSummary.from && d <= journalSummary.to)
                    .map(([d, rows]) => {
                      const s = summarize(rows);
                      return [
                        <Button key="d" small variant="ghost" onClick={() => selectDay(d)}>
                          {d}
                        </Button>,
                        <span
                          key="e"
                          style={{ color: s.engineNet > 0 ? "var(--green)" : s.engineNet < 0 ? "var(--red)" : undefined }}
                        >
                          {money(s.engineNet)}
                        </span>,
                        <span
                          key="u"
                          style={{ color: s.userGross > 0 ? "var(--green)" : s.userGross < 0 ? "var(--red)" : undefined }}
                        >
                          {money(s.userGross)}
                        </span>,
                        s.matched,
                        s.missedByYou,
                        s.engineSkipped ? <Badge key="sk" tone="amber">{s.engineSkipped}</Badge> : 0,
                      ];
                    })}
                />
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
