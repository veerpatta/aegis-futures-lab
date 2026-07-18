"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMarket, type MarketPayload } from "@/lib/data/fetch";
import { CONTRACT_LABELS, type FeedSymbol } from "@/lib/market/contracts";
import { aggregateMinutes } from "@/lib/strategies/zone-v5/engine";
import { STRATEGIES, strategyById } from "@/lib/strategies/registry";
import { defaultParams, type ReadoutRow, type Snapshot } from "@/lib/strategies/types";
import { money } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { Badge, Button, Panel, SelectField, toneClass } from "@/components/ui";
import CandleChart from "@/components/chart/CandleChart";
import styles from "./markets.module.css";

type QuoteState =
  | { status: "loading" }
  | { status: "ready"; quote: MarketPayload }
  | { status: "error"; error: string };

const TIMEFRAMES = [
  { id: 5, label: "5m" },
  { id: 15, label: "15m" },
  { id: 60, label: "1H" },
];

export default function MarketsClient() {
  const data = useData();
  const [quotes, setQuotes] = useState<Record<FeedSymbol, QuoteState>>({
    MES: { status: "loading" },
    MNQ: { status: "loading" },
  });
  const [chartSymbol, setChartSymbol] = useState<FeedSymbol>("MES");
  const [tf, setTf] = useState(5);
  const [readoutStrategy, setReadoutStrategy] = useState("zone-v5");

  useEffect(() => {
    let alive = true;
    const load = () => {
      (["MES", "MNQ"] as FeedSymbol[]).forEach((symbol) => {
        fetchMarket(symbol)
          .then((quote) => {
            if (alive) setQuotes((q) => ({ ...q, [symbol]: { status: "ready", quote } }));
          })
          .catch((e: Error) => {
            if (alive) setQuotes((q) => ({ ...q, [symbol]: { status: "error", error: e.message } }));
          });
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const chartBars = useMemo(() => {
    const bars = data.history[chartSymbol].bars;
    if (!bars.length) return [];
    return tf === 5 ? bars : aggregateMinutes(bars, tf);
  }, [data.history, chartSymbol, tf]);

  const readoutRows: ReadoutRow[] = useMemo(() => {
    if (data.history.MES.status !== "ready" || data.history.MNQ.status !== "ready") return [];
    const strategy = strategyById(readoutStrategy);
    try {
      const series = { MES: data.history.MES.bars, MNQ: data.history.MNQ.bars };
      const cutoff = data.replayCutoff;
      const visible = Object.fromEntries(
        Object.entries(series).map(([s, bars]) => {
          const cut = cutoff ? bars.filter((b) => b.time <= cutoff) : bars;
          return [s, cut];
        })
      );
      if (Object.values(visible).some((b) => b.length < 30)) return [];
      const params = defaultParams(strategy);
      const ctx = strategy.prepare(visible, params, {
        cost: 2.4,
        slippage: 0.25,
        maxRisk: 160,
        sizing: "risk",
      });
      const snap: Snapshot = {
        time: Math.min(...Object.values(visible).map((b) => b[b.length - 1].time)),
        bySymbol: Object.fromEntries(
          Object.entries(visible).map(([s, bars]) => [s, { bars, index: bars.length - 1 }])
        ),
      };
      return strategy.liveReadout?.(ctx, snap, params) ?? [];
    } catch {
      return [];
    }
  }, [data.history, readoutStrategy, data.replayCutoff]);

  const nowSec = Date.now() / 1000;
  const upcoming = data.events
    .map((e) => ({ ...e, sec: new Date(e.time).getTime() / 1000 }))
    .filter((e) => e.sec > nowSec - 1800)
    .sort((a, b) => a.sec - b.sec)
    .slice(0, 8);

  return (
    <>
      <h1 className="pageTitle">Markets</h1>
      <p className="pageSub">
        Free delayed research feed — display only, never execution-grade.
      </p>

      <div className={styles.quotes}>
        {(["MES", "MNQ"] as FeedSymbol[]).map((symbol) => {
          const q = quotes[symbol];
          return (
            <div key={symbol} className={styles.quoteCard}>
              <div className={styles.quoteHead}>
                <span>
                  <span className={styles.quoteSym}>{symbol}</span>{" "}
                  <span className={styles.quoteName}>{CONTRACT_LABELS[symbol]}</span>
                </span>
                <Badge tone={q.status === "error" ? "red" : "amber"}>
                  {q.status === "error" ? "FEED OFFLINE" : "DELAYED"}
                </Badge>
              </div>
              {q.status === "ready" ? (
                <>
                  <span className={`${styles.quotePrice} num`}>
                    {q.quote.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <span
                    className={styles.quoteChange}
                    style={{ color: q.quote.change >= 0 ? "var(--green)" : "var(--red)" }}
                  >
                    {money(q.quote.change)} vs prior close
                  </span>
                  <span className={styles.quoteMeta}>
                    data {new Date(q.quote.dataTimestamp).toLocaleTimeString()} ·{" "}
                    {q.quote.source}
                  </span>
                </>
              ) : q.status === "error" ? (
                <span className={styles.note}>{q.error}</span>
              ) : (
                <span className={styles.note}>loading…</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.grid}>
        <Panel
          title="Chart"
          actions={
            <span className={styles.chartControls}>
              {(["MES", "MNQ"] as FeedSymbol[]).map((s) => (
                <Button
                  key={s}
                  small
                  variant={s === chartSymbol ? "primary" : "ghost"}
                  onClick={() => setChartSymbol(s)}
                >
                  {s}
                </Button>
              ))}
              {TIMEFRAMES.map((t) => (
                <Button
                  key={t.id}
                  small
                  variant={t.id === tf ? "primary" : "ghost"}
                  onClick={() => setTf(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </span>
          }
        >
          {chartBars.length ? (
            <CandleChart bars={chartBars} height={380} />
          ) : (
            <span className={styles.note}>
              {data.history[chartSymbol].status === "error"
                ? `Feed error: ${data.history[chartSymbol].error}`
                : "Loading 60-day history…"}
            </span>
          )}
        </Panel>

        <div className={styles.sideCol}>
          <Panel title="Signal readout" hint={data.replayCutoff ? "at replay cutoff" : "latest bar"}>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <SelectField
                label="Strategy"
                value={readoutStrategy}
                onChange={setReadoutStrategy}
                options={STRATEGIES.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div className={styles.readout}>
              {readoutRows.length ? (
                readoutRows.map((r, i) => (
                  <div key={i} className={styles.readoutRow}>
                    <span className={styles.readoutLabel}>{r.label}</span>
                    <span className={toneClass(r.tone)}>{r.value}</span>
                  </div>
                ))
              ) : (
                <span className={styles.note}>
                  Waiting for both feeds — the readout runs the selected strategy on the latest
                  completed bars with default parameters.
                </span>
              )}
            </div>
          </Panel>

          <Panel title="News lockouts" hint={data.eventsSource ?? "calendar unavailable"}>
            <div className={styles.eventList}>
              {upcoming.length ? (
                upcoming.map((e) => {
                  const locked = Math.abs(e.sec - nowSec) <= 1800;
                  return (
                    <div key={`${e.name}-${e.time}`} className={styles.eventRow}>
                      <span className={styles.eventTime}>
                        {new Date(e.time).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className={styles.eventBody}>
                        <b>{e.name}</b>
                        <span>{e.publisher}</span>
                      </span>
                      <Badge tone={locked ? "red" : "amber"}>
                        {locked ? "LOCKED" : "±30 MIN"}
                      </Badge>
                    </div>
                  );
                })
              ) : (
                <span className={styles.note}>No upcoming verified events.</span>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
