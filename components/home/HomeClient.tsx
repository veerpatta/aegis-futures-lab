"use client";

/* Home — the default screen. One glance answers the three questions a trader
   actually opens the app for: is anything live right now, how has the bot been
   doing, and is the bot healthy. Everything here is read from the same tables
   the Signals terminal uses (signals / zones / engine_runs) plus the delayed
   quote feed — nothing on this page is illustrative.

   That rule is the reason several things in the native-app comp are not
   literal copies of it. The comp's hero carries a "+6.4%" return badge; this
   app has no account equity to compute a return against, so the badge shows
   profit factor, which is real. The comp's heartbeat bars are decorative
   heights; here a bar's height is how long that check took and its colour is
   how the check ended. Where the comp invented a number, this file shows the
   nearest true one or nothing. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getSupabase,
  type EngineRunRow,
  type LearningRunRow,
  type SignalRow,
  type ZoneRow,
} from "@/lib/supabase/client";
import { streamKeyForRow, streamLabel } from "@/lib/engine/streams";
import { fetchMarket, type MarketPayload } from "@/lib/data/fetch";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { nyMeta, tradingDayKey } from "@/lib/time/ny";
import {
  ago,
  dayLabelLong,
  fmtStamp,
  fmtTime,
  marketPhase,
  nextRunSec,
} from "@/lib/time/session";
import { dayKeyLabel, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import LiveVsTuning from "./LiveVsTuning";
import WhyNoSignal from "./WhyNoSignal";
import SignalContext, { useConditionLedger } from "@/components/signals/SignalContext";
import SignalSheet from "@/components/signals/SignalSheet";
import { money } from "@/lib/format";
import { fmtPf, profitFactor } from "@/lib/stats";
import { statusLook } from "@/lib/signals/status";
import styles from "./home.module.css";

const REFRESH_MS = 60_000;
const TARGET_PER_DAY = 3; // pace dots: the 2-3 ideas/day goal
const WINDOW_DAYS = 21; // "last 3 weeks"
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];

const SHORT_NAME: Record<string, string> = {
  MES: "S&P micro",
  MNQ: "Nasdaq micro",
};

/* Plain-language name for what produced a signal — the Guide's wording. */
function tierName(tier: "A" | "B"): string {
  return tier === "A" ? "zone setup" : "daily flow";
}

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/* Weekdays between two instants — the denominator for ideas-per-day. */
function weekdaysBetween(fromMs: number, toMs: number): number {
  let n = 0;
  for (let t = fromMs; t <= toMs; t += 86400_000) {
    const wd = nyMeta(Math.floor(t / 1000)).weekday;
    if (wd !== "Sat" && wd !== "Sun") n++;
  }
  return n;
}

/* ── Range hero ──────────────────────────────────────────────────────────
   Today / this week / three weeks over the same signal set, so the three
   readings can never come from different filters. */

type RangeKey = "today" | "week" | "month";

const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  week: "This week",
  month: "3 weeks",
};

const RANGE_SHORT: Record<RangeKey, string> = {
  today: "Today",
  week: "Week",
  month: "3 wks",
};

interface RangeStats {
  net: number;
  ideas: number;
  closed: number;
  wins: number;
  losses: number;
  pf: number | null;
  /** Cumulative net after each closed idea, oldest first. */
  curve: number[];
}

function rangeStats(signals: SignalRow[], fromMs: number | null, dateKey: string | null): RangeStats {
  const inRange = signals.filter((s) => {
    if (dateKey !== null)
      return nyMeta(Math.floor(new Date(s.signal_ts).getTime() / 1000)).dateKey === dateKey;
    return fromMs === null || new Date(s.signal_ts).getTime() >= fromMs;
  });
  const closed = inRange
    .filter((s) => s.pnl_usd !== null)
    .sort(
      (a, b) =>
        new Date(a.exit_ts ?? a.signal_ts).getTime() - new Date(b.exit_ts ?? b.signal_ts).getTime()
    );
  let run = 0;
  const curve = closed.map((s) => (run += s.pnl_usd ?? 0));
  return {
    net: run,
    ideas: inRange.length,
    closed: closed.length,
    wins: closed.filter((s) => (s.pnl_usd ?? 0) > 0).length,
    losses: closed.filter((s) => (s.pnl_usd ?? 0) <= 0).length,
    pf: profitFactor(closed.map((s) => s.pnl_usd ?? 0)),
    curve,
  };
}

/* An area sparkline of the cumulative curve. Returns null when there is not
   enough closed history to draw an honest line. */
function curvePaths(curve: number[]): { line: string; fill: string } | null {
  if (curve.length < 2) return null;
  const W = 320;
  const H = 60;
  const lo = Math.min(0, ...curve);
  const hi = Math.max(0, ...curve);
  const span = hi - lo || 1;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * W;
    const y = H - 4 - ((v - lo) / span) * (H - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${pts.join(" L")}`;
  return { line, fill: `${line} L${W},${H} L0,${H} Z` };
}

/* ── Daily P&L bars ──────────────────────────────────────────────────────── */

function PnlBars({ days }: { days: [string, number][] }) {
  if (days.length === 0)
    return <p className={styles.emptyNote}>No closed ideas in the last three weeks yet.</p>;

  const W = 720;
  const H = 96;
  const BASE = 62; // zero line
  const UP = BASE - 10; // room above the line
  const DOWN = H - BASE - 6; // room below
  const step = W / days.length;
  const bw = Math.min(30, Math.max(5, step * 0.62));
  const max = Math.max(...days.map(([, v]) => Math.abs(v)), 1);

  return (
    <>
      <svg
        className={styles.bars}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily profit and loss for the last ${days.length} trading days`}
      >
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="var(--border)" strokeWidth="1" />
        {days.map(([key, v], i) => {
          const h = Math.max(2, (Math.abs(v) / max) * (v >= 0 ? UP : DOWN));
          const x = i * step + (step - bw) / 2;
          return (
            <rect
              key={key}
              x={x.toFixed(1)}
              y={(v >= 0 ? BASE - h : BASE).toFixed(1)}
              width={bw.toFixed(1)}
              height={h.toFixed(1)}
              rx="4"
              fill={v >= 0 ? "var(--green)" : "var(--red)"}
              opacity={v >= 0 ? 1 : 0.85}
            >
              <title>{`${key}: ${money(v)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className={styles.barAxis}>
        <span>{dayKeyLabel(days[0][0], { weekday: false })}</span>
        {days.length > 2 && (
          <span>{dayKeyLabel(days[Math.floor(days.length / 2)][0], { weekday: false })}</span>
        )}
        <span>{dayKeyLabel(days[days.length - 1][0], { weekday: false })}</span>
      </div>
    </>
  );
}

/* ── Quote sparkline ─────────────────────────────────────────────────────── */

function QuoteSpark({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return <span className={styles.quoteSpark} />;
  const W = 110;
  const H = 28;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - 2 - ((c - min) / span) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={styles.quoteSpark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={up ? "var(--green)" : "var(--red)"}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ── Bot heartbeat ───────────────────────────────────────────────────────
   One bar per scheduled check. Height is how long the check took, colour is
   how it ended — both real fields on engine_runs, unlike the comp's
   decorative heights. */

function Heartbeat({ runs }: { runs: EngineRunRow[] }) {
  const { zone } = useZone();
  if (runs.length === 0)
    return <span className={styles.beatNote}>No checks recorded yet.</span>;

  const ordered = [...runs].reverse(); // oldest → newest, left to right
  const maxMs = Math.max(...ordered.map((r) => r.duration_ms ?? 0), 1);
  const ok = ordered.filter((r) => r.status === "ok").length;

  return (
    <>
      <div className={styles.beats}>
        {ordered.map((r) => {
          const pct = Math.max(0.25, (r.duration_ms ?? 0) / maxMs);
          const cls =
            r.status === "ok" ? styles.beatOk : r.status === "error" ? styles.beatBad : styles.beatSkip;
          return (
            <i
              key={r.id}
              className={cls}
              style={{ height: `${(pct * 100).toFixed(0)}%` }}
              title={`${fmtStamp(r.ran_at, zone)} · ${r.status}${
                r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ""
              }`}
            />
          );
        })}
      </div>
      <span className={ok === ordered.length ? styles.beatGood : styles.beatWarn}>
        {ok === ordered.length
          ? `All ${ordered.length} checks ran clean`
          : `${ok} of ${ordered.length} checks clean`}
      </span>
    </>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; signals: SignalRow[]; zones: ZoneRow[] };

export default function HomeClient() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [quotes, setQuotes] = useState<Partial<Record<FeedSymbol, MarketPayload>>>({});
  /* null until mounted — the clock must not render on the server. */
  const [nowSec, setNowSec] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("today");
  const [sheet, setSheet] = useState<SignalRow | null>(null);
  const [learningRun, setLearningRun] = useState<LearningRunRow | null>(null);
  const { zone } = useZone();
  const { mask } = usePrivacy();
  const health = useBotHealth();

  const load = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [signals, zones, learning] = await Promise.all([
        supabase.from("signals").select("*").order("signal_ts", { ascending: false }).limit(200),
        supabase.from("zones").select("*").limit(120),
        supabase
          .from("learning_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const err = signals.error || zones.error;
      if (err) throw new Error(err.message);
      if (!learning.error) setLearningRun((learning.data as LearningRunRow | null) ?? null);
      setState({
        status: "ready",
        signals: (signals.data ?? []) as SignalRow[],
        zones: (zones.data ?? []) as ZoneRow[],
      });
    } catch (e) {
      setState((prev) =>
        prev.status === "ready"
          ? prev
          : { status: "error", error: e instanceof Error ? e.message : String(e) }
      );
    }
    for (const symbol of SYMBOLS) {
      fetchMarket(symbol)
        .then((q) => setQuotes((p) => ({ ...p, [symbol]: q })))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  /* The header's tap-to-refresh chip bumps this, so one tap reloads the whole
     screen rather than just the engine-health strip. */
  useEffect(() => {
    if (health.revision > 0) load();
  }, [health.revision, load]);

  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const ready = state.status === "ready" ? state : null;
  /* Headline surfaces exclude breaker-suppressed streams; they simulate
     silently and are surfaced separately as "paused" below. Stale-data rows
     (item 2.4) are excluded for the same reason: they were computed on bars
     the engine could not actually have seen. Both stay visible in their
     drawers on Signals. */
  const signals = useMemo(
    () => (ready?.signals ?? []).filter((s) => !s.suppressed && !s.stale_data),
    [ready]
  );
  /* Item 2.8 — the nightly condition ledger, fetched once for every card. */
  const ledger = useConditionLedger();

  const pausedStreams = useMemo(() => {
    if (!ready) return [];
    const latest = new Map<string, (typeof health.policy)[number]>();
    for (const p of health.policy) if (!latest.has(p.stream)) latest.set(p.stream, p);
    const out: { stream: string; since: string; recoveryPf: number | null; n: number }[] = [];
    for (const [stream, p] of latest) {
      if (p.action !== "paused") continue;
      const recent = ready.signals
        .filter(
          (s) =>
            s.suppressed &&
            s.pnl_usd !== null &&
            s.fill_confidence !== "doubtful" &&
            streamKeyForRow(s) === stream
        )
        .slice(0, 15);
      out.push({
        stream,
        since: p.changed_at,
        recoveryPf: profitFactor(recent.map((s) => s.pnl_usd ?? 0)),
        n: recent.length,
      });
    }
    return out;
  }, [ready, health.policy]);

  const phase = marketPhase(nowSec ?? 0);
  const nextRun = nowSec === null ? null : nextRunSec(nowSec);

  /* Today, in New York. */
  const todayKey = nowSec === null ? null : nyMeta(nowSec).dateKey;
  const today = useMemo(
    () => (todayKey === null ? null : rangeStats(signals, null, todayKey)),
    [signals, todayKey]
  );

  const hero = useMemo(
    () => (range === "today" ? today : rangeStats(signals, Date.now() - (range === "week" ? 7 : WINDOW_DAYS) * 86400_000, null)),
    [range, today, signals]
  );

  /* The one idea worth putting at the top: live first, then waiting-to-fill. */
  const live = useMemo(
    () =>
      signals.find((s) => s.status === "triggered") ??
      signals.find((s) => s.status === "pending") ??
      null,
    [signals]
  );

  /* Rolling three-week window — the daily bars and the tier split. */
  const perf = useMemo(() => {
    const fromMs = Date.now() - WINDOW_DAYS * 86400_000;
    const window = signals.filter((s) => new Date(s.signal_ts).getTime() >= fromMs);
    const closed = window.filter((s) => s.pnl_usd !== null);
    const wins = closed.filter((s) => (s.pnl_usd ?? 0) > 0).length;
    const byDay = new Map<string, number>();
    for (const s of closed) {
      const key = nyMeta(Math.floor(new Date(s.exit_ts ?? s.signal_ts).getTime() / 1000)).dateKey;
      byDay.set(key, (byDay.get(key) ?? 0) + (s.pnl_usd ?? 0));
    }
    const tradingDays = weekdaysBetween(fromMs, Date.now());
    const tierNet = (t: "A" | "B") =>
      closed.filter((s) => s.tier === t).reduce((a, s) => a + (s.pnl_usd ?? 0), 0);
    const exPnls = closed
      .filter((s) => s.fill_confidence !== "doubtful")
      .map((s) => s.pnl_usd ?? 0);
    return {
      exNet: exPnls.reduce((a, v) => a + v, 0),
      exPf: profitFactor(exPnls),
      ideas: window.length,
      closed: closed.length,
      net: closed.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      perDay: tradingDays ? window.length / tradingDays : null,
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      tierA: tierNet("A"),
      tierB: tierNet("B"),
    };
  }, [signals]);

  /* Green streak: consecutive most-recent trading days that finished up, and
     the best such run inside the same three-week window. */
  const streak = useMemo(() => {
    let current = 0;
    for (let i = perf.days.length - 1; i >= 0; i--) {
      if (perf.days[i][1] > 0) current++;
      else break;
    }
    let best = 0;
    let run = 0;
    for (const [, v] of perf.days) {
      run = v > 0 ? run + 1 : 0;
      if (run > best) best = run;
    }
    return { current, best };
  }, [perf.days]);

  const recent = useMemo(
    () => signals.filter((s) => s.id !== live?.id).slice(0, 3),
    [signals, live]
  );

  /* Zones nearest to the delayed price. */
  const nearZones = useMemo(() => {
    const rows = (ready?.zones ?? []).map((z) => {
      const price = quotes[z.symbol as FeedSymbol]?.price;
      if (!price) return { z, dist: null as number | null, inside: false };
      if (price >= z.price_low && price <= z.price_high) return { z, dist: 0, inside: true };
      const edge = z.price_low > price ? z.price_low : z.price_high;
      return { z, dist: (Math.abs(edge - price) / price) * 100, inside: false };
    });
    return rows
      .filter((r) => r.dist !== null)
      .sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))
      .slice(0, 3);
  }, [ready, quotes]);

  const loading = state.status === "loading";
  const heroPaths = hero ? curvePaths(hero.curve) : null;

  /* Live-trade readout against the delayed quote. */
  const livePrice = live ? quotes[live.symbol as FeedSymbol]?.price ?? null : null;
  const liveOpen = useMemo(() => {
    if (!live || livePrice === null || live.status !== "triggered") return null;
    const pv = POINT_VALUES[live.symbol as FeedSymbol] ?? 1;
    const dir = live.direction === "long" ? 1 : -1;
    return (livePrice - live.entry_price) * pv * (live.qty ?? 1) * dir;
  }, [live, livePrice]);

  /* Position on the stop → target rail. The formula works for both directions:
     for a short, target sits below stop and the denominator flips sign with
     the numerator. */
  const railPct = (v: number | null): number | null => {
    if (!live || v === null || live.target_price === null) return null;
    const span = live.target_price - live.stop_price;
    if (span === 0) return null;
    return Math.max(3, Math.min(97, ((v - live.stop_price) / span) * 100));
  };
  const entryPct = railPct(live?.entry_price ?? null);
  const pricePct = railPct(livePrice);

  /* "Updated", not "last check": this is when the APP last re-read the tables.
     The bot's own last check is a different moment and is reported by its own
     name in the Bot status card below — the two used to both read "last check"
     and mean different things. */
  const refreshLabel = health.refreshing
    ? "Checking for new ideas…"
    : health.loadedAt === null
      ? "Loading…"
      : health.loadFailed
        ? `Could not reach the feed · showing ${ago(new Date(health.loadedAt).toISOString())} · tap to retry`
        : `Updated ${ago(new Date(health.loadedAt).toISOString())} · tap to refresh`;

  return (
    <div className={`${styles.page} riseIn`}>
      {/* ── Tap to refresh ── */}
      <button
        type="button"
        className={`${styles.refreshChip} pressSm`}
        onClick={health.refresh}
        disabled={health.refreshing}
      >
        <span
          className={styles.refreshRing}
          data-spinning={health.refreshing || undefined}
          aria-hidden
        />
        {refreshLabel}
      </button>

      {/* ── Desktop greeting ── */}
      <div className={styles.deskGreeting}>
        <h1 className={styles.h1}>
          {nowSec === null ? "Welcome back" : greeting(nyMeta(nowSec).hour)}
        </h1>
        <p className={styles.sub}>
          {nowSec === null ? "Loading the session…" : dayLabelLong(new Date(nowSec * 1000), zone)} ·
          here&rsquo;s what the bot has been doing
        </p>
      </div>

      <div className={styles.pills}>
        <span className={`${styles.pill} ${styles[phase.tone]}`}>
          <i className={`${styles.dot} ${phase.live ? styles.dotLive : ""}`} />
          <span className={styles.pillMain}>{phase.label}</span>
          <span className={styles.pillDetail}>· {phase.detail}</span>
        </span>
        <span className={`${styles.pill} ${styles.pillMuted} ${styles.deskOnly}`}>
          Next check{" "}
          <b className="num">
            {nextRun === null
              ? "—"
              : `${fmtTime(new Date(nextRun * 1000).toISOString(), zone)} ${ZONE_ABBR[zone]}`}
          </b>
        </span>
      </div>

      <span className={styles.paperBadge}>PAPER TRADING · DELAYED DATA</span>

      {state.status === "error" && (
        <div className={styles.errorBar} role="status">
          Signal feed unreachable ({state.error}). Retrying every minute.
        </div>
      )}

      {pausedStreams.length > 0 && (
        <section className={styles.card} aria-label="Paused streams" style={{ padding: "12px 16px" }}>
          {pausedStreams.map((p) => (
            <div key={p.stream} className={styles.cellSub} style={{ display: "block", marginBottom: 2 }}>
              <span className={styles.warn}>⏸︎ {streamLabel(p.stream)} paused by the breaker</span>{" "}
              since {fmtStamp(p.since, zone)} —{" "}
              {p.n === 0
                ? "recovering in silent practice"
                : `recovering: PF ${fmtPf(p.recoveryPf)} over ${p.n}`}
              . Still simulating, hidden from the numbers above.
            </div>
          ))}
        </section>
      )}

      <div className={styles.grid}>
        {/* ── Main column ── */}
        <div className={styles.mainCol}>
          {/* ── P&L hero with the range switch ── */}
          <section className={styles.hero} aria-label="Profit and loss">
            <div className={styles.heroTop}>
              <span className={styles.heroKicker}>{RANGE_LABEL[range]} P&amp;L</span>
              <div className={styles.segment} role="group" aria-label="Range">
                {(["today", "week", "month"] as RangeKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={k === range ? `${styles.seg} ${styles.segOn}` : styles.seg}
                    aria-pressed={k === range}
                    onClick={() => setRange(k)}
                  >
                    {RANGE_SHORT[k]}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.heroFigure}>
              <b
                className={`${styles.heroAmount} num ${
                  hero && hero.net < 0 ? styles.bad : styles.good
                }`}
              >
                {hero ? mask(money(hero.net)) : "—"}
              </b>
              {hero && hero.closed > 0 && (
                <span
                  className={`${styles.heroDelta} ${hero.net < 0 ? styles.deltaBad : styles.deltaGood}`}
                >
                  PF {fmtPf(hero.pf)}
                </span>
              )}
            </div>
            <div className={styles.heroSub}>
              {hero === null
                ? "Loading…"
                : hero.ideas === 0
                  ? loading
                    ? "Loading the signal log."
                    : "No ideas in this window yet."
                  : `${hero.ideas} idea${hero.ideas === 1 ? "" : "s"} · ${hero.closed} closed · ${
                      hero.wins
                    } win${hero.wins === 1 ? "" : "s"} · ${hero.losses} loss${
                      hero.losses === 1 ? "" : "es"
                    }`}
            </div>
            {heroPaths ? (
              <svg
                viewBox="0 0 320 60"
                preserveAspectRatio="none"
                className={styles.heroSpark}
                role="img"
                aria-label={`Running profit and loss across ${RANGE_LABEL[range].toLowerCase()}`}
              >
                <defs>
                  <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--green)" stopOpacity="0.34" />
                    <stop offset="1" stopColor="var(--green)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={heroPaths.fill} fill="url(#heroFade)" />
                <path
                  d={heroPaths.line}
                  fill="none"
                  stroke={hero && hero.net < 0 ? "var(--red)" : "var(--green)"}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : (
              <span className={styles.heroSparkEmpty}>
                Two closed ideas are needed before the running total draws a line.
              </span>
            )}
          </section>

          {/* ── The open idea, with its risk rail ── */}
          {live ? (
            <section className={styles.live} aria-label="Open idea">
              <div className={styles.liveHead}>
                <span className={styles.liveTitle}>
                  <span className={live.direction === "long" ? styles.sideBuy : styles.sideSell}>
                    {live.direction === "long" ? "BUY" : "SELL"}
                  </span>
                  <span className={styles.liveSymbol}>{live.symbol}</span>
                  <span className={styles.liveName}>{SHORT_NAME[live.symbol] ?? live.symbol}</span>
                </span>
                <span
                  className={`${styles.liveState} ${
                    live.status === "pending" ? styles.warn : styles.info
                  }`}
                >
                  <i
                    className={`${styles.dotSm} ${live.status === "triggered" ? styles.dotPulse : ""}`}
                  />
                  {statusLook(live.status).label}
                </span>
              </div>

              <div className={styles.liveFigures}>
                <div className={styles.liveFig}>
                  <span className={styles.cellLabel}>
                    {live.status === "triggered" ? "Open P&L" : "Waiting to fill"}
                  </span>
                  <b
                    className={`${styles.liveBig} num ${
                      liveOpen === null ? "" : liveOpen >= 0 ? styles.good : styles.bad
                    }`}
                  >
                    {liveOpen === null ? "—" : mask(money(liveOpen))}
                  </b>
                </div>
                <div className={`${styles.liveFig} ${styles.liveFigEnd}`}>
                  <span className={styles.cellLabel}>Last</span>
                  <b className={`${styles.liveLast} num`}>
                    {livePrice === null ? "—" : livePrice.toFixed(2)}
                  </b>
                </div>
              </div>

              {live.target_price !== null && entryPct !== null ? (
                <div className={styles.rail}>
                  <div className={styles.railTrack}>
                    <span className={styles.railEntry} style={{ left: `${entryPct}%` }} aria-hidden />
                    {pricePct !== null && (
                      <span
                        className={styles.railPrice}
                        style={{ left: `${pricePct}%` }}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className={styles.railLabels}>
                    <span className={styles.bad}>
                      <span className="num">{live.stop_price.toFixed(2)}</span>{" "}
                      <span className={styles.railWord}>stop</span>
                    </span>
                    <span className={styles.dim}>
                      <span className="num">{live.entry_price.toFixed(2)}</span>{" "}
                      <span className={styles.railWord}>entry</span>
                    </span>
                    <span className={styles.good}>
                      <span className="num">{live.target_price.toFixed(2)}</span>{" "}
                      <span className={styles.railWord}>target</span>
                    </span>
                  </div>
                  {pricePct === null && (
                    <span className={styles.railNote}>
                      Waiting on the delayed quote to place the marker.
                    </span>
                  )}
                </div>
              ) : (
                <div className={styles.railLabels}>
                  <span className={styles.bad}>
                    <span className="num">{live.stop_price.toFixed(2)}</span>{" "}
                    <span className={styles.railWord}>stop</span>
                  </span>
                  <span className={styles.dim}>
                    <span className="num">{live.entry_price.toFixed(2)}</span>{" "}
                    <span className={styles.railWord}>entry</span>
                  </span>
                  <span className={styles.dim}>
                    <span className={styles.railWord}>no target set</span>
                  </span>
                </div>
              )}

              <div className={styles.liveFoot}>
                <span>
                  {live.reason ?? tierName(live.tier)}{" "}
                  <span className={styles.info}>· Tier {live.tier}</span>
                  {live.rr !== null && (
                    <span className={styles.deskInline}> · {live.rr.toFixed(1)} : 1 reward</span>
                  )}
                </span>
              </div>

              <div className={styles.liveActions}>
                <button
                  type="button"
                  className={`${styles.btnPrimary} press`}
                  onClick={() => setSheet(live)}
                >
                  Trade detail
                </button>
                <Link href="/markets" className={`${styles.btnIcon} press`} aria-label="Open chart">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                    <path d="M7 4v3M7 15v5M17 4v5M17 17v3" />
                    <rect x="5" y="7" width="4" height="8" rx="0.5" />
                    <rect x="15" y="9" width="4" height="8" rx="0.5" />
                  </svg>
                </Link>
                <Link href="/replay" className={`${styles.btnIcon} press`} aria-label="Open journal">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </Link>
              </div>
            </section>
          ) : (
            <section className={styles.liveEmpty} aria-label="Open idea">
              <span className={styles.liveEmptyMark}>◇</span>
              <div>
                <div className={styles.liveEmptyTitle}>
                  {loading ? "Loading today's ideas…" : "Nothing open right now"}
                </div>
                <p className={styles.liveEmptyBody}>
                  {loading
                    ? "Reading the signal log."
                    : phase.live
                      ? `The bot is watching. Next check ${
                          nextRun === null
                            ? "shortly"
                            : `at ${fmtTime(new Date(nextRun * 1000).toISOString(), zone)} ${ZONE_ABBR[zone]}`
                        } — an idea appears here the moment one triggers.`
                      : `${phase.detail}. Ideas resume when the entry window opens.`}
                </p>
              </div>
              <Link href="/signals" className={styles.liveEmptyLink}>
                All signals →
              </Link>
            </section>
          )}

          {/* ── Watchlist ── */}
          <section className={styles.listCard} aria-label="Watchlist">
            <div className={styles.listHead}>
              <h2 className={styles.cardTitle}>Watchlist</h2>
              <Link href="/markets" className={styles.cardLink}>
                Markets →
              </Link>
            </div>
            {SYMBOLS.map((symbol) => {
              const q = quotes[symbol];
              const changePct = q && q.previousClose ? (q.change / q.previousClose) * 100 : null;
              const up = (q?.change ?? 0) >= 0;
              return (
                <Link key={symbol} href="/markets" className={`${styles.watchRow} pressSm`}>
                  <span className={styles.watchName}>
                    <b>{symbol}</b>
                    <span className={styles.watchSub}>{SHORT_NAME[symbol]}</span>
                  </span>
                  <QuoteSpark closes={(q?.bars ?? []).slice(-120).map((b) => b.close)} up={up} />
                  <span className={styles.watchVals}>
                    <b className="num">
                      {q ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                    </b>
                    <span className={`num ${up ? styles.good : styles.bad}`}>
                      {changePct === null
                        ? "—"
                        : `${up ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`}
                    </span>
                  </span>
                </Link>
              );
            })}
            <span className={styles.note}>Delayed 10–15 min · display only</span>
          </section>

          {/* ── Heartbeat + streak ── */}
          <section className={styles.duo} aria-label="Bot health">
            <div className={styles.duoCell}>
              <span className={styles.cellLabel}>Bot heartbeat</span>
              <Heartbeat runs={health.runs} />
            </div>
            <div className={styles.duoCell}>
              <span className={styles.cellLabel}>Green streak</span>
              <b className={`${styles.duoBig} num`}>
                {streak.current} <span className={styles.duoUnit}>day{streak.current === 1 ? "" : "s"}</span>
              </b>
              <span className={styles.beatNote}>
                {perf.days.length === 0
                  ? "No closed days yet"
                  : `Best in 3 weeks: ${streak.best}`}
              </span>
            </div>
          </section>
          <Link href="/brain" className={`${styles.learningPulse} pressSm`}>
            <span>
              <span className={styles.cellLabel}>Learning loop</span>
              <b
                className={
                  learningRun?.status === "error"
                    ? styles.bad
                    : learningRun?.status === "blocked"
                      ? styles.warn
                      : learningRun?.status === "running"
                        ? styles.info
                        : styles.good
                }
              >
                {learningRun
                  ? learningRun.status === "running"
                    ? "Checking new evidence"
                    : learningRun.status === "ok"
                      ? "Evidence gate passed"
                      : learningRun.status === "blocked"
                        ? "Change blocked safely"
                        : "Learning run needs attention"
                  : "Waiting for first audited run"}
              </b>
            </span>
            <span className={styles.learningPulseMeta}>
              {learningRun
                ? `${learningRun.cadence} · ${ago(learningRun.finished_at ?? learningRun.started_at)}`
                : "Daily learn · weekly promotion"}
              <span aria-hidden> →</span>
            </span>
          </Link>

          {/* ── Recent ideas ── */}
          <section className={styles.listCard} aria-label="Recent ideas">
            <div className={styles.listHead}>
              <h2 className={styles.cardTitle}>Recent ideas</h2>
              <Link href="/signals" className={styles.cardLink}>
                See all →
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className={styles.emptyNote}>
                {loading
                  ? "Loading…"
                  : "No ideas logged yet — the engine writes them as setups trigger."}
              </p>
            ) : (
              recent.map((s) => {
                const look = statusLook(s.status);
                return (
                  <div key={s.id} className={styles.recentItem}>
                    <button
                      type="button"
                      className={`${styles.row} pressSm`}
                      onClick={() => setSheet(s)}
                      aria-label={`Open ${s.direction === "long" ? "buy" : "sell"} ${s.symbol} detail`}
                    >
                      <span
                        className={`${styles.rowMark} ${
                          s.direction === "long" ? styles.markUp : styles.markDown
                        }`}
                        aria-hidden
                      >
                        {s.direction === "long" ? "▲" : "▼"}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>
                          {s.direction === "long" ? "Buy" : "Sell"} {s.symbol} ·{" "}
                          <span className="num">{s.entry_price.toFixed(2)}</span>
                        </span>
                        <span className={styles.rowSub}>
                          {fmtStamp(s.signal_ts, zone)} · {tierName(s.tier)} (Tier {s.tier})
                        </span>
                      </span>
                      <span className={styles.rowEnd}>
                        <b
                          className={`num ${
                            s.pnl_usd === null
                              ? styles.dim
                              : s.pnl_usd >= 0
                                ? styles.good
                                : styles.bad
                          }`}
                        >
                          {s.pnl_usd === null ? "—" : mask(money(s.pnl_usd))}
                        </b>
                        <span className={`${styles.tag} ${styles[look.tone]}`}>{look.label}</span>
                        {s.fill_confidence === "marginal" && (
                          <span className={`${styles.tag} ${styles.warn}`}>MARGINAL FILL</span>
                        )}
                        {s.fill_confidence === "doubtful" && (
                          <span className={`${styles.tag} ${styles.bad}`}>DOUBTFUL FILL</span>
                        )}
                      </span>
                    </button>
                    {/* Item 2.8 — setup, what invalidates it, the matching
                        condition-ledger cell (always with its n) and the
                        model's win probability, without a click. On a phone
                        the same four facts live in the detail sheet, so the
                        row stays one thumb tall. */}
                    <div className={`${styles.rowCtx} ${styles.deskOnly}`}>
                      <SignalContext signal={s} ledger={ledger} />
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* ── Three-week performance ── */}
          <section className={styles.card} aria-label="Bot performance">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Bot · last 3 weeks</h2>
              <span className={styles.cardHint}>daily P&amp;L, closed ideas, costs included</span>
              <Link href="/signals" className={styles.cardLink}>
                All signals →
              </Link>
            </div>
            <div className={styles.perfStats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Net</span>
                <b className={`${styles.bigValue} num ${perf.net < 0 ? styles.bad : styles.good}`}>
                  {mask(money(perf.net))}
                </b>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Win rate</span>
                <b className={`${styles.bigValue} num`}>
                  {perf.winRate === null ? "—" : `${perf.winRate.toFixed(0)}%`}
                </b>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Ideas</span>
                <b className={`${styles.bigValue} num`}>{perf.ideas}</b>
              </div>
              <div className={`${styles.stat} ${styles.deskOnly}`}>
                <span className={styles.statLabel}>Per day</span>
                <b className={`${styles.bigValue} num`}>
                  {perf.perDay === null ? "—" : perf.perDay.toFixed(1)}
                </b>
              </div>
              <div className={`${styles.stat} ${styles.tierSplit} ${styles.deskOnly}`}>
                <span className={styles.statLabel}>Zone setups vs daily flow</span>
                <span className={styles.tierLine}>
                  <b className={styles.info}>A {mask(money(perf.tierA))}</b> ·{" "}
                  <b className={styles.warn}>B {mask(money(perf.tierB))}</b>
                </span>
              </div>
            </div>
            <PnlBars days={perf.days} />
            <p className={styles.emptyNote}>
              excluding doubtful fills: PF {fmtPf(perf.exPf)} · net {mask(money(perf.exNet))} — ideas
              where price only kissed the entry level are counted out here
            </p>
          </section>
        </div>

        {/* ── Right rail ── */}
        <div className={styles.rail2}>
          <section className={styles.card} aria-label="Today">
            <h2 className={styles.cardTitle}>Today</h2>
            <div className={styles.todayStrip}>
              <div className={styles.todayCell}>
                <span className={styles.cellLabel}>Ideas today</span>
                <span className={styles.cellValueRow}>
                  <b className={`${styles.cellValue} num`}>{today ? today.ideas : "—"}</b>
                  <span className={styles.paceDots} aria-hidden>
                    {Array.from({ length: TARGET_PER_DAY }, (_, i) => (
                      <i key={i} className={today && i < today.ideas ? styles.paceOn : styles.paceOff} />
                    ))}
                  </span>
                </span>
                <span className={styles.cellSub}>target 2–3 / day</span>
              </div>
              <div className={styles.todayCell}>
                <span className={styles.cellLabel}>Today P&amp;L</span>
                <b
                  className={`${styles.cellValue} num ${
                    today && today.net < 0 ? styles.bad : styles.good
                  }`}
                >
                  {today ? mask(money(today.net)) : "—"}
                </b>
                <span className={styles.cellSub}>
                  {today ? `${today.wins} win · ${today.losses} loss` : "—"}
                </span>
              </div>
              <div className={styles.todayCell}>
                <span className={styles.cellLabel}>Next check · {ZONE_ABBR[zone]}</span>
                <b className={`${styles.cellValue} num`}>
                  {nextRun === null ? "—" : fmtTime(new Date(nextRun * 1000).toISOString(), zone)}
                </b>
                <span
                  className={`${styles.cellSub} ${
                    health.stale ? styles.warn : health.asleep ? "" : styles.good
                  }`}
                >
                  {health.loading
                    ? "checking…"
                    : health.asleep
                      ? "bot asleep"
                      : health.stale
                        ? "bot idle"
                        : "bot healthy ✓"}
                </span>
              </div>
            </div>
          </section>

          <section className={styles.card} aria-label="Zones to watch">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Zones to watch</h2>
              <Link href="/signals" className={styles.cardLink}>
                All →
              </Link>
            </div>
            {nearZones.length === 0 ? (
              <p className={styles.emptyNote}>
                {loading ? "Loading…" : "No zones within reach of the delayed price."}
              </p>
            ) : (
              nearZones.map(({ z, dist, inside }) => (
                <div key={z.id} className={`${styles.zoneRow} ${inside ? styles.zoneAt : ""}`}>
                  <span
                    className={`${styles.zoneDist} ${
                      inside ? styles.warn : z.zone_type === "demand" ? styles.good : styles.bad
                    }`}
                  >
                    {inside
                      ? "AT ZONE"
                      : (dist ?? 0) < 0.05
                        ? "<0.1% AWAY"
                        : `${(dist ?? 0).toFixed(1)}% AWAY`}
                  </span>
                  <span className={styles.zoneText}>
                    <b>{z.symbol}</b> {z.zone_type === "demand" ? "buy" : "sell"} area{" "}
                    <span className="num">
                      {z.price_low.toFixed(0)}–{z.price_high.toFixed(0)}
                    </span>
                  </span>
                  <span className={styles.zoneMeta}>
                    {z.timeframe}
                    {z.fresh ? " · fresh" : ""}
                  </span>
                </div>
              ))
            )}
          </section>

          {/* Item 2.7 — answers "is it broken or just patient?" without a
              support conversation, from the engine's own per-day funnel. */}
          {/* Trading day, matching the key run-live.ts writes the funnel under:
              after 18:00 ET the session on screen is the next weekday's. */}
          <WhyNoSignal dateKey={tradingDayKey(Math.floor(Date.now() / 1000))} />

          <LiveVsTuning signals={signals} />

          <section className={styles.card} aria-label="Bot status">
            <h2 className={styles.cardTitle}>Bot status</h2>
            <div className={styles.statusLine}>
              <i
                className={`${styles.dotSm} ${
                  health.stale ? styles.dotWarn : health.asleep ? styles.dotSkip : styles.dotGood
                }`}
              />
              {health.lastRun
                ? `Last check ${ago(health.lastRun.ran_at)} · ${
                    health.lastRun.status !== "ok"
                      ? "run failed"
                      : health.asleep
                        ? nextRun === null
                          ? "asleep until the next session"
                          : `asleep until ${fmtTime(new Date(nextRun * 1000).toISOString(), zone)} ${ZONE_ABBR[zone]}`
                        : health.stale
                          ? "waiting on the next pass"
                          : "all good"
                  }`
                : health.loading
                  ? "Checking…"
                  : "No engine runs recorded yet"}
            </div>
            {health.delayed && (
              <div className={`${styles.statusLine} ${styles.warn}`}>
                <i className={`${styles.dotSm} ${styles.dotWarn}`} />
                Data delayed more than usual — signals catch up on the next pass
              </div>
            )}
            {health.alerts
              .filter((a) => a.id === "news")
              .map((a) => (
                <div key={a.id} className={styles.statusLine}>
                  <i className={`${styles.dotSm} ${styles.dotWarn}`} />
                  {a.text}
                </div>
              ))}
          </section>
        </div>
      </div>

      <Link href="/guide" className={`${styles.guidePointer} pressSm`}>
        <span className={styles.guideIcon} aria-hidden>
          📖
        </span>
        <span className={styles.guideText}>
          <span className={styles.guideTitle}>New here? Read the 5-minute guide</span>
          <span className={styles.guideSub}>What the ideas mean and how to keep score</span>
        </span>
        <span className={styles.guideArrow} aria-hidden>
          →
        </span>
      </Link>

      <SignalSheet signal={sheet} ledger={ledger} onClose={() => setSheet(null)} />
    </div>
  );
}
