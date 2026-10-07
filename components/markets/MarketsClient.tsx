"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchMarket, type MarketPayload } from "@/lib/data/fetch";
import { getNeon, type ZoneRow } from "@/lib/neon/client";
import { CONTRACT_LABELS, FEED_SYMBOLS, type FeedSymbol } from "@/lib/market/contracts";
import { fmtCountdown, marketPhase, sessionRemainingSec } from "@/lib/time/session";
import { aggregateMinutes } from "@/lib/strategies/zone-v5/engine";
import { DAILY_FUNNEL_STAT_KEY, parseDailyFunnel, summarizeDailyFunnel, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { tradingDayKey } from "@/lib/time/ny";
import { sentenceCase } from "@/lib/plain/text";
import { Term } from "@/components/ui/Glossary";
import { points } from "@/lib/format";
import { useData } from "@/components/providers/DataProvider";
import { clockIn, dateTimeIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { Badge } from "@/components/ui";
import CandleChart, { token, type PriceLine, type ZoneBox } from "@/components/chart/CandleChart";
import { zoneToBox } from "@/components/chart/zoneBoxes";
import PriceArea from "./PriceArea";
import page from "@/components/ui/page.module.css";
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

/* `?symbol=MES|MNQ&focus=<unix seconds>` — a link from an idea opens the chart
   on that market, and with a focus time, on the candles around that moment.
   Kept in its own Suspense boundary so reading the URL never holds back the
   rest of the page's server render. */
function LinkReader({ onLink }: { onLink: (symbol: FeedSymbol | null, focus: number | null) => void }) {
  const params = useSearchParams();
  const rawSymbol = params.get("symbol");
  const rawFocus = params.get("focus");
  useEffect(() => {
    const upper = rawSymbol?.toUpperCase();
    const symbol: FeedSymbol | null = upper === "MES" || upper === "MNQ" ? upper : null;
    const n = rawFocus === null ? NaN : Number(rawFocus);
    const focus = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    if (symbol !== null || focus !== null) onLink(symbol, focus);
  }, [rawSymbol, rawFocus, onLink]);
  return null;
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
  /* A moment a link asked to see (unix seconds). Cleared as soon as the reader
     picks another market or timeframe themselves. */
  const [focus, setFocus] = useState<number | null>(null);
  const onLink = useCallback((symbol: FeedSymbol | null, at: number | null) => {
    if (symbol) setChartSymbol(symbol);
    if (at !== null) {
      setFocus(at);
      setTf(5);
      setChartStyle("candles");
    }
  }, []);
  const pickSymbol = (s: FeedSymbol) => {
    setFocus(null);
    setChartSymbol(s);
  };
  const pickTf = (id: number) => {
    setFocus(null);
    setTf(id);
  };
  /* The engine's own count of today's checks — what it looked at and what
     turned ideas away — rather than a re-run here with default parameters,
     which could disagree with what the live engine actually did. */
  const [funnel, setFunnel] = useState<DailyFunnelPayload | null | undefined>(undefined);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  /* null until mounted — the session countdown must not render on the server. */
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    setTick(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    data.ensureHistory([chartSymbol]);
  }, [chartSymbol, data.ensureHistory]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve(
      getNeon()
        .from("learned_stats")
        .select("payload")
        .eq("stat_key", DAILY_FUNNEL_STAT_KEY)
        .order("date_key", { ascending: false })
        .limit(1)
    ).then(({ data: rows, error }) => {
      if (alive) setFunnel(error || !rows?.length ? null : parseDailyFunnel(rows[0].payload));
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    getNeon()
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

  /* Keyed on this market's own bar array, so the other market's feed landing
     does not hand the chart a fresh copy of the same candles. */
  const feedBars = data.history[chartSymbol].bars;
  const chartBars = useMemo(() => {
    if (!feedBars.length) return [];
    return tf === 5 ? feedBars : aggregateMinutes(feedBars, tf);
  }, [feedBars, tf]);

  const tradingDay = tick === null ? null : tradingDayKey(tick);
  const whyNone = useMemo(
    () => (funnel === undefined || tradingDay === null ? null : summarizeDailyFunnel(funnel, tradingDay)),
    [funnel, tradingDay]
  );

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

  /* Memoised on the number itself: the quote object is replaced every minute
     and the page re-renders every second, and neither should touch the chart. */
  const prevClose = heroQuote?.previousClose ?? null;
  const chartLines = useMemo<PriceLine[]>(
    () =>
      prevClose === null
        ? []
        : [{ price: prevClose, color: token("--blue", "#5aa7ff"), title: "prev close", dashed: true }],
    [prevClose]
  );

  const nowSec = Date.now() / 1000;
  const upcoming = data.events
    .map((e) => ({ ...e, sec: new Date(e.time).getTime() / 1000 }))
    .filter((e) => e.sec > nowSec - 1800)
    .sort((a, b) => a.sec - b.sec)
    .slice(0, 8);

  return (
    <div className={page.page}>
      <Suspense fallback={null}>
        <LinkReader onLink={onLink} />
      </Suspense>

      <header className={page.head}>
        <h1 className="pageTitle">Chart</h1>
        <p className={page.lede}>
          Where the two markets are, the price areas the bot watches, and the news it steps aside for.{" "}
          <Term k="delayed">Delayed prices</Term>, for practice only.
        </p>
      </header>

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

      {/* ── Hero: the symbol you are looking at ── */}
      <section className={styles.hero} aria-label={`${chartSymbol} price`}>
        <div className={styles.heroHead}>
          <div className={styles.heroName}>
            <div className={styles.symToggle} role="group" aria-label="Select symbol">
              {(["MES", "MNQ"] as FeedSymbol[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === chartSymbol ? `${styles.symPill} ${styles.symOn}` : styles.symPill}
                  aria-pressed={s === chartSymbol}
                  onClick={() => pickSymbol(s)}
                >
                  {s}
                </button>
              ))}
            </div>
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
            <span className={`${styles.heroChg} num ${heroUp ? styles.good : styles.bad}`}>
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
              previousClose={prevClose}
              up={heroUp}
              label={`${chartSymbol} price over the loaded window, with the previous close marked. Touch the line to read a price and time.`}
            />
          ) : (
            <div className={styles.heroCandles}>
              <CandleChart
                bars={chartBars}
                boxes={chartBoxes}
                lines={chartLines}
                fitKey={`${chartSymbol}:${tf}`}
                focusTime={focus}
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
              onClick={() => pickTf(t.id)}
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

      {/* ── Price areas to watch (the engine's zones) ── */}
      <section className={page.card} aria-label="Price areas to watch">
        <h2 className={page.cardTitle}>Price areas to watch</h2>
        <p className={page.note}>
          <Term k="zone">Zones</Term> where strong buying or selling showed up before. The zone method looks for a
          bounce when price comes back to one.
        </p>
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
                  <b>{z.symbol === "MES" ? "S&P" : z.symbol === "MNQ" ? "Nasdaq" : z.symbol}</b>{" "}
                  {z.zone_type === "demand" ? "buy" : "sell"} area{" "}
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
            <span className={page.note}>No price areas near the delayed price right now.</span>
          )}
        </div>
      </section>

      {/* ── The other contract, one tap away ── */}
      <button
        type="button"
        className={`${styles.otherRow} press`}
        onClick={() => pickSymbol(otherSymbol)}
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

      {/* ── Why no idea right now? ── */}
      <section className={page.card} aria-label="Why no idea right now?">
        <h2 className={page.cardTitle}>Why no idea right now?</h2>
        {whyNone === null ? (
          <p className={`${page.note} pulse`}>Reading the latest check…</p>
        ) : (
          <>
            {!phase.live && tick !== null && (
              <p className={styles.whySentence}>
                <b>The market is closed</b>, so no new ideas until it reopens. The last check said:
              </p>
            )}
            <p className={styles.whySentence}>{sentenceCase(whyNone.sentence)}</p>
            {whyNone.blockers.length > 0 && (
              <div className={styles.readout}>
                {whyNone.blockers.slice(0, 4).map((b) => (
                  <div key={b.reason} className={styles.readoutRow}>
                    <span className={styles.readoutLabel}>{b.label}</span>
                    <span className="num">{b.count.toLocaleString("en-US")}</span>
                  </div>
                ))}
              </div>
            )}
            <p className={page.note}>
              From the engine&apos;s own count at its latest check. Turning ideas away is the methods being picky,
              not a fault.
            </p>
          </>
        )}
      </section>

      {/* ── Big news ahead ── */}
      <section className={page.card} aria-label="Big news ahead">
        <h2 className={page.cardTitle}>Big news ahead</h2>
        <p className={page.note}>
          <Term k="newsPause">The bot takes no new ideas 30 minutes either side of these.</Term>
        </p>
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
                  <Badge tone={locked ? "amber" : undefined}>
                    {locked ? "PAUSED NOW" : "±30 MIN"}
                  </Badge>
                </div>
              );
            })
          ) : (
            <span className={page.note}>No big news on the calendar right now.</span>
          )}
        </div>
        <p className={page.note}>Calendar: {data.eventsSource ?? "unavailable right now"}</p>
      </section>
    </div>
  );
}
