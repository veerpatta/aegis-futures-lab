"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMarket, type MarketPayload } from "@/lib/data/fetch";
import { getSupabase, type ZoneRow } from "@/lib/supabase/client";
import { CONTRACT_LABELS, FEED_SYMBOLS, type FeedSymbol } from "@/lib/market/contracts";
import { fmtCountdown, marketPhase, sessionRemainingSec } from "@/lib/time/session";
import { aggregateMinutes } from "@/lib/strategies/zone-v5/engine";
import { STRATEGIES, strategyById, isUnmeasured } from "@/lib/strategies/registry";
import { defaultParams, type ReadoutRow, type Snapshot } from "@/lib/strategies/types";
import { points } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { clockIn, dateTimeIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { Badge, Button, Panel, SelectField, toneClass } from "@/components/ui";
import CandleChart, { type ZoneBox } from "@/components/chart/CandleChart";
import { zoneToBox } from "@/components/chart/zoneBoxes";
import PriceArea from "./PriceArea";
import styles from "./markets.module.css";

type QuoteState =
  | { status: "loading" }
  | { status: "ready"; quote: MarketPayload }
  | { status: "error"; error: string };

/* The design's five timeframe pills. 4H and 1D are aggregated from the same
   5-minute feed the others use. */
const TIMEFRAMES = [
  { id: 5, label: "5m" },
  { id: 15, label: "15m" },
  { id: 60, label: "1H" },
  { id: 240, label: "4H" },
  { id: 1440, label: "1D" },
];

/* Short names for the hero header — CONTRACT_LABELS is the long legal name and
   is too wide for the card. */
const SHORT_NAME: Record<FeedSymbol, string> = {
  MES: "S&P 500 micro",
  MNQ: "Nasdaq micro",
  MGC: "Gold micro",
  SI: "Silver",
};

/* The 100×30 sparkline on the secondary contract row. */
function MiniSpark({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return <span className={styles.otherSpark} />;
  const W = 100;
  const H = 30;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const d = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - 3 - ((c - min) / span) * (H - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={styles.otherSpark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--green)" : "var(--red)"}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function MarketsClient() {
  const data = useData();
  const { zone } = useZone();
  /* Built from FEED_SYMBOLS so a newly fetchable instrument cannot be
     half-added: the map and the union can no longer disagree. */
  const [quotes, setQuotes] = useState<Record<FeedSymbol, QuoteState>>(() =>
    Object.fromEntries(
      FEED_SYMBOLS.map((s) => [s, { status: "loading" } as QuoteState])
    ) as Record<FeedSymbol, QuoteState>
  );
  const [chartSymbol, setChartSymbol] = useState<FeedSymbol>("MES");
  const [tf, setTf] = useState(5);
  /* The hero opens on the design's line chart; candles are one tap away on the
     same card rather than a second chart further down the page. */
  const [chartStyle, setChartStyle] = useState<"line" | "candles">("line");
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
      .or("active.is.null,active.eq.true")
      .neq("status", "broken")
      .order("created_at", { ascending: false })
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

  /* The charted symbol's zones as rectangles. A demand zone is entered at its
     HIGH (price falls into it) and a supply zone at its LOW — that asymmetry
     is why proximal/distal is worth drawing at all rather than a single band.
     Freshness dims a zone price has already worked through. */
  const chartBoxes = useMemo<ZoneBox[]>(
    () =>
      zones.filter((z) => z.symbol === chartSymbol && z.status !== "broken").map(zoneToBox),
    [zones, chartSymbol]
  );

  const phase = marketPhase(tick ?? 0);
  const remaining = tick === null ? null : sessionRemainingSec(tick);

  /* Hero = the contract in the chart; the other one gets the compact row under
     the zones, and tapping it swaps the two. */
  const otherSymbol: FeedSymbol = chartSymbol === "MES" ? "MNQ" : "MES";
  const heroState = quotes[chartSymbol];
  const heroQuote = heroState.status === "ready" ? heroState.quote : null;
  const otherState = quotes[otherSymbol];
  const otherQuote = otherState.status === "ready" ? otherState.quote : null;
  const pctOf = (q: MarketPayload | null) =>
    q && q.previousClose ? (q.change / q.previousClose) * 100 : null;
  const heroPct = pctOf(heroQuote);
  const otherPct = pctOf(otherQuote);
  const heroUp = (heroQuote?.change ?? 0) >= 0;
  const otherUp = (otherQuote?.change ?? 0) >= 0;

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

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          {/* ── Hero: the symbol you are looking at ── */}
          <section className={styles.hero} aria-label={`${chartSymbol} price`}>
            <div className={styles.heroHead}>
              <div className={styles.heroName}>
                <b className={styles.heroSym}>{chartSymbol}</b>
                <span className={styles.heroSub}>
                  {SHORT_NAME[chartSymbol]}
                  {heroQuote && (
                    <>
                      {" · data "}
                      {clockIn(
                        Math.floor(new Date(heroQuote.dataTimestamp).getTime() / 1000),
                        zone
                      )}{" "}
                      {ZONE_ABBR[zone]}
                    </>
                  )}
                </span>
              </div>
              <div className={styles.heroPrice}>
                <b className={`${styles.heroPx} num`}>
                  {heroQuote
                    ? heroQuote.price.toLocaleString(undefined, { minimumFractionDigits: 2 })
                    : "—"}
                </b>
                <span
                  className={`${styles.heroChg} num ${heroUp ? styles.good : styles.bad}`}
                >
                  {heroQuote
                    ? `${points(heroQuote.change)} · ${heroPct === null ? "—" : `${heroUp ? "+" : "−"}${Math.abs(heroPct).toFixed(2)}%`}`
                    : heroState.status === "error"
                      ? "feed offline"
                      : "loading…"}
                </span>
              </div>
            </div>

            {chartBars.length ? (
              chartStyle === "line" ? (
                <PriceArea
                  bars={chartBars}
                  previousClose={heroQuote?.previousClose ?? null}
                  up={heroUp}
                  label={`${chartSymbol} price over the loaded window, with the previous close marked`}
                />
              ) : (
                <div className={styles.heroCandles}>
                  <CandleChart
                    bars={chartBars}
                    height={300}
                    boxes={chartBoxes}
                    lines={
                      heroQuote
                        ? [
                            {
                              price: heroQuote.previousClose,
                              color: "#5aa7ff",
                              title: "prev close",
                              dashed: true,
                            },
                          ]
                        : []
                    }
                  />
                </div>
              )
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

            <div className={styles.tfRow} role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === tf ? `${styles.tfPill} ${styles.tfOn}` : styles.tfPill}
                  aria-pressed={t.id === tf}
                  onClick={() => setTf(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className={styles.heroFoot}>
              <span className={styles.styleToggle} role="group" aria-label="Chart style">
                {(["line", "candles"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={s === chartStyle ? `${styles.tfPill} ${styles.tfOn}` : styles.tfPill}
                    aria-pressed={s === chartStyle}
                    onClick={() => setChartStyle(s)}
                  >
                    {s === "line" ? "Line" : "Candles"}
                  </button>
                ))}
              </span>
              <Badge tone={heroState.status === "error" ? "red" : "amber"}>
                {heroState.status === "error" ? "FEED OFFLINE" : "DELAYED"}
              </Badge>
            </div>
          </section>

          {/* ── Zones near price ── */}
          <section className={styles.card} aria-label="Zones near price">
            <h2 className={styles.cardTitle}>Zones near price</h2>
            <div className={styles.zoneList}>
              {nearZones.length ? (
                nearZones.map(({ z, dist, inside, above }) => (
                  <div key={z.id} className={`${styles.zoneRow} ${inside ? styles.zoneAt : ""}`}>
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
                <span className={styles.note}>No zones within reach of the delayed price yet.</span>
              )}
            </div>
          </section>

          {/* ── The other contract, one tap away ── */}
          <button
            type="button"
            className={`${styles.otherRow} press`}
            onClick={() => setChartSymbol(otherSymbol)}
            aria-label={`Show ${otherSymbol} in the chart`}
          >
            <span className={styles.otherName}>
              <b>{otherSymbol}</b>
              <span className={styles.otherSub}>{SHORT_NAME[otherSymbol]}</span>
            </span>
            <MiniSpark
              closes={(otherQuote?.bars ?? []).slice(-120).map((b) => b.close)}
              up={otherUp}
            />
            <span className={styles.otherVals}>
              <b className="num">
                {otherQuote
                  ? otherQuote.price.toLocaleString(undefined, { minimumFractionDigits: 2 })
                  : "—"}
              </b>
              <span className={`num ${otherUp ? styles.good : styles.bad}`}>
                {otherPct === null
                  ? "—"
                  : `${otherUp ? "+" : "−"}${Math.abs(otherPct).toFixed(2)}%`}
              </span>
            </span>
          </button>

          <span className={styles.delayedNote}>Delayed 10–15 min · display only</span>
        </div>

        <div className={styles.sideCol}>
          <Panel title="Signal readout" hint={data.replayCutoff ? "at replay cutoff" : "latest bar"}>
            <div style={{ marginBottom: "var(--space-3)" }}>
              <SelectField
                label="Strategy"
                value={readoutStrategy}
                onChange={setReadoutStrategy}
                options={STRATEGIES.map((s) => ({
                  value: s.id,
                  /* A dropdown cannot carry a colour chip, so the standing rides
                     in the label. Silence here would let an unmeasured strategy
                     read exactly like a measured one. */
                  label: isUnmeasured(s.id) ? `${s.name} · unmeasured` : s.name,
                }))}
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
