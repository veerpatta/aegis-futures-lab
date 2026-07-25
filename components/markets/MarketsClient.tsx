"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMarket, type MarketPayload } from "@/lib/data/fetch";
import { getSupabase, type ZoneRow } from "@/lib/supabase/client";
import { CONTRACT_LABELS, type FeedSymbol } from "@/lib/market/contracts";
import { fmtCountdown, marketPhase, sessionRemainingSec } from "@/lib/time/session";
import { aggregateMinutes } from "@/lib/strategies/zone-v5/engine";
import { STRATEGIES, strategyById } from "@/lib/strategies/registry";
import { defaultParams, type ReadoutRow, type Snapshot } from "@/lib/strategies/types";
import { money } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { clockIn, dateTimeIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
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
  const { zone } = useZone();
  const [quotes, setQuotes] = useState<Record<FeedSymbol, QuoteState>>({
    MES: { status: "loading" },
    MNQ: { status: "loading" },
  });
  const [chartSymbol, setChartSymbol] = useState<FeedSymbol>("MES");
  const [tf, setTf] = useState(5);
  const [readoutStrategy, setReadoutStrategy] = useState("zone-v5");
  const [zones, setZones] = useState<ZoneRow[]>([]);
  /* null until mounted — the session countdown must not render on the server. */
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    setTick(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getSupabase()
      .from("zones")
      .select("*")
      .limit(120)
      .then(({ data: rows, error }) => {
        if (!error) setZones((rows ?? []) as ZoneRow[]);
      });
  }, []);

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

  /* Zones nearest the delayed price, for the "near price" card. */
  const nearZones = useMemo(() => {
    const priced = zones.map((z) => {
      const q = quotes[z.symbol as FeedSymbol];
      const price = q?.status === "ready" ? q.quote.price : null;
      if (price === null) return { z, dist: null as number | null, inside: false, above: false };
      if (price >= z.price_low && price <= z.price_high)
        return { z, dist: 0, inside: true, above: false };
      const above = z.price_low > price;
      const edge = above ? z.price_low : z.price_high;
      return { z, dist: (Math.abs(edge - price) / price) * 100, inside: false, above };
    });
    return priced
      .filter((r) => r.dist !== null)
      .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
      .slice(0, 4);
  }, [zones, quotes]);

  const phase = marketPhase(tick ?? 0);
  const remaining = tick === null ? null : sessionRemainingSec(tick);

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

      {/* ── Session strip: which session, and how long is left in it ── */}
      <div className={styles.sessionStrip}>
        <i
          className={`${styles.sessionDot} ${styles[phase.tone]} ${
            phase.live ? styles.sessionLive : ""
          }`}
          aria-hidden
        />
        <span className={styles.sessionText}>
          {tick === null ? "Reading the session clock…" : `${phase.label} · ${phase.detail}`}
        </span>
        {remaining !== null && (
          <b className={`${styles.sessionLeft} num`}>{fmtCountdown(remaining)} left</b>
        )}
      </div>

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
                    data {clockIn(Math.floor(new Date(q.quote.dataTimestamp).getTime() / 1000), zone)}{" "}
                    {ZONE_ABBR[zone]} ·{" "}
                    {q.quote.source}
                  </span>
                </>
              ) : q.status === "error" ? (
                <span className={styles.note}>{q.error}</span>
              ) : (
                <span className={`${styles.note} pulse`}>loading…</span>
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
              <span className={styles.segmented}>
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
              </span>
              <span className={styles.segmented}>
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
            </span>
          }
        >
          {chartBars.length ? (
            <CandleChart bars={chartBars} height={380} />
          ) : (
            <span
              className={
                data.history[chartSymbol].status === "error"
                  ? styles.note
                  : `${styles.note} pulse`
              }
            >
              {data.history[chartSymbol].status === "error"
                ? `Feed error: ${data.history[chartSymbol].error}`
                : "Loading 60-day history…"}
            </span>
          )}
        </Panel>

        <div className={styles.sideCol}>
          <Panel title="Zones near price" hint="from the engine's zone table · nearest first">
            <div className={styles.zoneList}>
              {nearZones.length ? (
                nearZones.map(({ z, dist, inside, above }) => (
                  <div
                    key={z.id}
                    className={`${styles.zoneRow} ${inside ? styles.zoneAt : ""}`}
                  >
                    <span
                      className={`${styles.zoneTag} ${
                        inside ? styles.warn : z.zone_type === "demand" ? styles.good : styles.bad
                      }`}
                    >
                      {inside
                        ? "AT ZONE"
                        : `${(dist ?? 0).toFixed(1)}% ${above ? "ABOVE" : "BELOW"}`}
                    </span>
                    <span className={styles.zoneBody}>
                      <b>{z.symbol}</b> {z.zone_type === "demand" ? "buy" : "sell"} area{" "}
                      <span className="num">
                        {z.price_low.toFixed(0)}–{z.price_high.toFixed(0)}
                      </span>
                    </span>
                    <span className={styles.zoneTf}>
                      {z.timeframe}
                      {z.fresh ? " · fresh" : ""}
                    </span>
                  </div>
                ))
              ) : (
                <span className={styles.note}>
                  No zones within reach of the delayed price yet.
                </span>
              )}
            </div>
          </Panel>

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
                        {dateTimeIn(e.sec, zone)} {ZONE_ABBR[zone]}
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
