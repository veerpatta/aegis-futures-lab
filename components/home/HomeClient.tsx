"use client";

/* Home — the default screen. One glance answers the three questions a trader
   actually opens the app for: is anything live right now, how has the bot been
   doing, and is the bot healthy. Everything here is read from the same tables
   the Signals terminal uses (signals / zones / engine_runs) plus the delayed
   quote feed — nothing on this page is illustrative. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getSupabase,
  type BotPolicyRow,
  type EngineRunRow,
  type SignalRow,
  type ZoneRow,
} from "@/lib/supabase/client";
import { streamKeyForRow, streamLabel } from "@/lib/engine/streams";
import { fetchEvents, fetchMarket, type CalendarEvent, type MarketPayload } from "@/lib/data/fetch";
import type { FeedSymbol } from "@/lib/market/contracts";
import { nyMeta } from "@/lib/time/ny";
import {
  ago,
  dataDelayed,
  dayLabelLong,
  fmtStamp,
  fmtTime,
  marketPhase,
  nextRunSec,
} from "@/lib/time/session";
import { dayKeyLabel, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import ZoneToggle from "@/components/nav/ZoneToggle";
import LiveVsTuning from "./LiveVsTuning";
import { money } from "@/lib/format";
import { fmtPf, profitFactor } from "@/lib/stats";
import styles from "./home.module.css";

const REFRESH_MS = 60_000;
const STALE_AFTER_MIN = 40; // two missed 15-min cron slots + jitter
const TARGET_PER_DAY = 3; // pace dots: the 2-3 ideas/day goal
const WINDOW_DAYS = 21; // "last 3 weeks"
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];

const SHORT_NAME: Record<string, string> = {
  MES: "S&P 500 micro",
  MNQ: "Nasdaq micro",
};

/* Plain-language name for what produced a signal — the Guide's wording. */
function tierName(tier: "A" | "B"): string {
  return tier === "A" ? "zone setup" : "daily flow";
}

interface StatusLook {
  label: string;
  tone: "good" | "bad" | "info" | "warn" | "dim";
}

function statusLook(s: SignalRow["status"]): StatusLook {
  switch (s) {
    case "hit_target":
      return { label: "TARGET HIT", tone: "good" };
    case "hit_stop":
      return { label: "STOPPED", tone: "bad" };
    case "triggered":
      return { label: "OPEN", tone: "info" };
    case "pending":
      return { label: "WAITING", tone: "warn" };
    case "expired":
      return { label: "FLAT CLOSE", tone: "dim" };
    default:
      return { label: s.toUpperCase(), tone: "dim" };
  }
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

/* ── Daily P&L bars ──────────────────────────────────────────────────── */

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
        {days.length > 2 && <span>{dayKeyLabel(days[Math.floor(days.length / 2)][0], { weekday: false })}</span>}
        <span>{dayKeyLabel(days[days.length - 1][0], { weekday: false })}</span>
      </div>
    </>
  );
}

/* ── Quote sparkline ─────────────────────────────────────────────────── */

function QuoteSpark({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return <span className={styles.quoteSpark} />;
  const W = 140;
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
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; signals: SignalRow[]; zones: ZoneRow[]; runs: EngineRunRow[]; policy: BotPolicyRow[] };

export default function HomeClient() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [quotes, setQuotes] = useState<Partial<Record<FeedSymbol, MarketPayload>>>({});
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  /* null until mounted — the clock must not render on the server. */
  const [nowSec, setNowSec] = useState<number | null>(null);
  const { zone } = useZone();

  const load = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [signals, zones, runs, policy] = await Promise.all([
        supabase.from("signals").select("*").order("signal_ts", { ascending: false }).limit(200),
        supabase.from("zones").select("*").limit(120),
        supabase.from("engine_runs").select("*").order("ran_at", { ascending: false }).limit(5),
        supabase.from("bot_policy").select("*").order("changed_at", { ascending: false }).limit(50),
      ]);
      const err = signals.error || zones.error || runs.error;
      if (err) throw new Error(err.message);
      setState({
        status: "ready",
        signals: (signals.data ?? []) as SignalRow[],
        zones: (zones.data ?? []) as ZoneRow[],
        runs: (runs.data ?? []) as EngineRunRow[],
        policy: (policy.data ?? []) as BotPolicyRow[],
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

  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchEvents()
      .then((p) => setEvents(p.events ?? []))
      .catch(() => undefined);
  }, []);

  const ready = state.status === "ready" ? state : null;
  // Headline surfaces (today, hero, three-week window, recent) exclude
  // breaker-suppressed streams; they simulate silently and are surfaced
  // separately as "paused" below.
  const signals = useMemo(() => (ready?.signals ?? []).filter((s) => !s.suppressed), [ready]);
  const pausedStreams = useMemo(() => {
    if (!ready) return [];
    const latest = new Map<string, BotPolicyRow>();
    for (const p of ready.policy) if (!latest.has(p.stream)) latest.set(p.stream, p);
    const out: { stream: string; since: string; recoveryPf: number | null; n: number }[] = [];
    for (const [stream, p] of latest) {
      if (p.action !== "paused") continue;
      const recent = ready.signals
        .filter((s) => s.suppressed && s.pnl_usd !== null && s.fill_confidence !== "doubtful" && streamKeyForRow(s) === stream)
        .slice(0, 15);
      out.push({ stream, since: p.changed_at, recoveryPf: profitFactor(recent.map((s) => s.pnl_usd ?? 0)), n: recent.length });
    }
    return out;
  }, [ready]);
  const lastRun = ready?.runs[0] ?? null;
  const engineStale =
    !lastRun || Date.now() - new Date(lastRun.ran_at).getTime() > STALE_AFTER_MIN * 60_000;
  const delayed = dataDelayed(ready?.runs ?? [], nowSec ?? Math.floor(Date.now() / 1000));

  const phase = marketPhase(nowSec ?? 0);
  const nextRun = nowSec === null ? null : nextRunSec(nowSec);

  /* Today, in New York. */
  const today = useMemo(() => {
    if (nowSec === null) return null;
    const key = nyMeta(nowSec).dateKey;
    const rows = signals.filter(
      (s) => nyMeta(Math.floor(new Date(s.signal_ts).getTime() / 1000)).dateKey === key
    );
    const closed = rows.filter((s) => s.pnl_usd !== null);
    return {
      count: rows.length,
      net: closed.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
      wins: closed.filter((s) => (s.pnl_usd ?? 0) > 0).length,
      losses: closed.filter((s) => (s.pnl_usd ?? 0) <= 0).length,
    };
  }, [signals, nowSec]);

  /* The one idea worth putting at the top: live first, then waiting-to-fill. */
  const hero = useMemo(
    () =>
      signals.find((s) => s.status === "triggered") ??
      signals.find((s) => s.status === "pending") ??
      null,
    [signals]
  );

  /* Rolling three-week window. */
  const perf = useMemo(() => {
    const fromMs = Date.now() - WINDOW_DAYS * 86400_000;
    const window = signals.filter((s) => new Date(s.signal_ts).getTime() >= fromMs);
    const closed = window.filter((s) => s.pnl_usd !== null);
    const wins = closed.filter((s) => (s.pnl_usd ?? 0) > 0).length;
    const byDay = new Map<string, number>();
    for (const s of closed) {
      const key = nyMeta(
        Math.floor(new Date(s.exit_ts ?? s.signal_ts).getTime() / 1000)
      ).dateKey;
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

  const recent = useMemo(
    () => signals.filter((s) => s.id !== hero?.id).slice(0, 3),
    [signals, hero]
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

  const nextEvent = useMemo(() => {
    const upcoming = events
      .filter((e) => new Date(e.time).getTime() > Date.now())
      .sort((a, b) => a.time.localeCompare(b.time));
    return upcoming[0] ?? null;
  }, [events]);

  const loading = state.status === "loading";

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <Link href="/" className={styles.phoneBrand}>
          <span className={styles.brandMark}>◆</span>
          <span className={styles.brandText}>
            <strong>Aegis</strong>
            <span className={styles.brandSub}>
              {nowSec === null ? "—" : dayLabelLong(new Date(nowSec * 1000), zone)}
            </span>
          </span>
        </Link>

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
          <span className={styles.phoneZone}>
            <ZoneToggle />
          </span>
          <span className={`${styles.pill} ${styles[phase.tone]}`}>
            <i className={`${styles.dot} ${phase.live ? styles.dotLive : ""}`} />
            <span className={styles.pillMain}>{phase.label}</span>
            <span className={styles.pillDetail}>· {phase.detail}</span>
          </span>
          <span className={`${styles.pill} ${styles.pillMuted} ${styles.deskOnly}`}>
            Next check{" "}
            <b className="num">{nextRun === null ? "—" : `${fmtTime(new Date(nextRun * 1000).toISOString(), zone)} ${ZONE_ABBR[zone]}`}</b>
          </span>
        </div>
      </header>

      <span className={styles.paperBadge}>PAPER TRADING · DELAYED DATA</span>

      {state.status === "error" && (
        <div className={styles.errorBar} role="status">
          Signal feed unreachable ({state.error}). Retrying every minute.
        </div>
      )}

      {/* ── Today strip (phone / tablet) ── */}
      <section className={styles.todayStrip} aria-label="Today">
        <div className={styles.todayCell}>
          <span className={styles.cellLabel}>Ideas today</span>
          <span className={styles.cellValueRow}>
            <b className={`${styles.cellValue} num`}>{today ? today.count : "—"}</b>
            <span className={styles.paceDots} aria-hidden>
              {Array.from({ length: TARGET_PER_DAY }, (_, i) => (
                <i key={i} className={today && i < today.count ? styles.paceOn : styles.paceOff} />
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
            {today ? money(today.net) : "—"}
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
          <span className={`${styles.cellSub} ${engineStale ? styles.warn : styles.good}`}>
            {loading ? "checking…" : engineStale ? "bot idle" : "bot healthy ✓"}
          </span>
        </div>
      </section>

      {pausedStreams.length > 0 && (
        <section className={`${styles.card}`} aria-label="Paused streams" style={{ padding: "12px 16px" }}>
          {pausedStreams.map((p) => (
            <div key={p.stream} className={styles.cellSub} style={{ display: "block", marginBottom: 2 }}>
              <span className={styles.warn}>⏸︎ {streamLabel(p.stream)} paused by the breaker</span>{" "}
              since {fmtStamp(p.since, zone)} —{" "}
              {p.n === 0 ? "recovering in silent practice" : `recovering: PF ${fmtPf(p.recoveryPf)} over ${p.n}`}. Still
              simulating, hidden from the numbers above.
            </div>
          ))}
        </section>
      )}

      <div className={styles.grid}>
        {/* ── Main column ── */}
        <div className={styles.mainCol}>
          {/* Hero: the open idea */}
          {hero ? (
            <section className={`${styles.hero} ${styles.card}`} aria-label="Open idea">
              <div className={styles.heroHead}>
                <span className={styles.heroTitle}>
                  <span
                    className={hero.direction === "long" ? styles.sideBuy : styles.sideSell}
                  >
                    {hero.direction === "long" ? "BUY" : "SELL"}
                  </span>
                  <span className={styles.heroSymbol}>{hero.symbol}</span>
                  <span className={styles.heroName}>
                    {SHORT_NAME[hero.symbol] ?? hero.symbol}
                    <span className={styles.deskInline}>
                      {" "}
                      · {tierName(hero.tier)} · Tier {hero.tier}
                    </span>
                  </span>
                </span>
                <span
                  className={`${styles.heroState} ${
                    hero.status === "pending" ? styles.warn : styles.info
                  }`}
                >
                  <i className={styles.dotSm} />
                  {statusLook(hero.status).label} · {fmtTime(hero.signal_ts, zone)} {ZONE_ABBR[zone]}
                </span>
              </div>
              <div className={styles.heroStats}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Entry</span>
                  <b className={`${styles.statValue} num`}>{hero.entry_price.toFixed(2)}</b>
                </div>
                <div className={styles.stat}>
                  <span className={`${styles.statLabel} ${styles.bad}`}>Stop</span>
                  <b className={`${styles.statValue} num ${styles.bad}`}>
                    {hero.stop_price.toFixed(2)}
                  </b>
                </div>
                <div className={styles.stat}>
                  <span className={`${styles.statLabel} ${styles.good}`}>Target</span>
                  <b className={`${styles.statValue} num ${styles.good}`}>
                    {hero.target_price?.toFixed(2) ?? "—"}
                  </b>
                </div>
                <div className={`${styles.stat} ${styles.deskOnly}`}>
                  <span className={styles.statLabel}>Reward : risk</span>
                  <b className={`${styles.statValue} num`}>
                    {hero.rr ? `${hero.rr.toFixed(1)} : 1` : "—"}
                  </b>
                </div>
              </div>
              <div className={styles.heroFoot}>
                <span>
                  {hero.reason ?? tierName(hero.tier)}{" "}
                  <span className={styles.info}>· Tier {hero.tier}</span>
                </span>
                <span className="num">
                  {hero.rr ? `${hero.rr.toFixed(1)} : 1 reward` : "—"}
                </span>
              </div>
            </section>
          ) : (
            <section className={`${styles.heroEmpty} ${styles.card}`} aria-label="Open idea">
              <span className={styles.heroEmptyMark}>◇</span>
              <div>
                <div className={styles.heroEmptyTitle}>
                  {loading ? "Loading today's ideas…" : "Nothing open right now"}
                </div>
                <p className={styles.heroEmptyBody}>
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
              <Link href="/signals" className={styles.heroEmptyLink}>
                All signals →
              </Link>
            </section>
          )}

          {/* Three-week performance */}
          <section className={`${styles.perf} ${styles.card}`} aria-label="Bot performance">
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
                <b
                  className={`${styles.bigValue} num ${perf.net < 0 ? styles.bad : styles.good}`}
                >
                  {money(perf.net)}
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
                  <b className={styles.info}>A {money(perf.tierA)}</b> ·{" "}
                  <b className={styles.warn}>B {money(perf.tierB)}</b>
                </span>
              </div>
            </div>
            <PnlBars days={perf.days} />
            <p className={styles.emptyNote}>
              excluding doubtful fills: PF {fmtPf(perf.exPf)} · net {money(perf.exNet)} — ideas
              where price only kissed the entry level are counted out here
            </p>
          </section>

          {/* Recent ideas */}
          <section className={`${styles.recent} ${styles.card}`} aria-label="Recent ideas">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Recent ideas</h2>
              <Link href="/signals" className={styles.cardLink}>
                See all →
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className={styles.emptyNote}>
                {loading ? "Loading…" : "No ideas logged yet — the engine writes them as setups trigger."}
              </p>
            ) : (
              recent.map((s) => {
                const look = statusLook(s.status);
                return (
                  <div key={s.id} className={styles.row}>
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
                        <span className={styles.deskInline}>
                          {" "}
                          · stop <span className="num">{s.stop_price.toFixed(2)}</span>
                          {s.target_price !== null && (
                            <>
                              {" "}
                              · target <span className="num">{s.target_price.toFixed(2)}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className={styles.rowEnd}>
                      <b
                        className={`num ${
                          s.pnl_usd === null ? styles.dim : s.pnl_usd >= 0 ? styles.good : styles.bad
                        }`}
                      >
                        {s.pnl_usd === null ? "—" : money(s.pnl_usd)}
                      </b>
                      <span className={`${styles.tag} ${styles[look.tone]}`}>{look.label}</span>
                      {s.fill_confidence === "marginal" && (
                        <span
                          className={`${styles.tag} ${styles.warn}`}
                          title="Price barely reached the entry level — a real resting order may not have filled first time"
                        >
                          MARGINAL FILL
                        </span>
                      )}
                      {s.fill_confidence === "doubtful" && (
                        <span
                          className={`${styles.tag} ${styles.bad}`}
                          title="Price only kissed the entry level and never came back — a real order likely never filled"
                        >
                          DOUBTFUL FILL
                        </span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </section>
        </div>

        {/* ── Right rail ── */}
        <div className={styles.rail}>
          <section className={`${styles.markets} ${styles.card}`} aria-label="Markets">
            <h2 className={styles.cardTitle}>Markets</h2>
            <div className={styles.quoteList}>
              {SYMBOLS.map((symbol) => {
                const q = quotes[symbol];
                const changePct =
                  q && q.previousClose ? (q.change / q.previousClose) * 100 : null;
                const up = (q?.change ?? 0) >= 0;
                return (
                  <Link key={symbol} href="/markets" className={styles.quote}>
                    <span className={styles.quoteName}>
                      <b>{symbol}</b>
                      <span className={styles.quoteSub}>{SHORT_NAME[symbol]}</span>
                    </span>
                    <QuoteSpark
                      closes={(q?.bars ?? []).slice(-120).map((b) => b.close)}
                      up={up}
                    />
                    <span className={styles.quoteVals}>
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
            </div>
            <span className={styles.note}>Delayed 10–15 min · display only</span>
          </section>

          <section className={`${styles.zones} ${styles.card}`} aria-label="Zones to watch">
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
                <div
                  key={z.id}
                  className={`${styles.zoneRow} ${inside ? styles.zoneAt : ""}`}
                >
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

          <LiveVsTuning signals={signals} />

          <section className={`${styles.status} ${styles.card}`} aria-label="Bot status">
            <h2 className={styles.cardTitle}>Bot status</h2>
            <div className={styles.statusLine}>
              <i className={`${styles.dotSm} ${engineStale ? styles.dotWarn : styles.dotGood}`} />
              {lastRun
                ? `Last check ${ago(lastRun.ran_at)} · ${
                    lastRun.status === "ok" ? (engineStale ? "waiting on the next pass" : "all good") : "run failed"
                  }`
                : loading
                  ? "Checking…"
                  : "No engine runs recorded yet"}
            </div>
            {delayed && (
              <div className={`${styles.statusLine} ${styles.warn}`}>
                <i className={`${styles.dotSm} ${styles.dotWarn}`} />
                Data delayed more than usual — signals catch up on the next pass
              </div>
            )}
            {nextEvent && (
              <div className={styles.statusLine}>
                <i className={`${styles.dotSm} ${styles.dotWarn}`} />
                News pause {fmtStamp(nextEvent.time, zone)} ({nextEvent.name})
              </div>
            )}
            {ready && ready.runs.length > 0 && (
              <div className={styles.runDots}>
                {[...ready.runs].reverse().map((r) => (
                  <span
                    key={r.id}
                    className={r.status === "ok" ? styles.runOk : styles.runBad}
                    title={`${fmtStamp(r.ran_at, zone)} · ${r.status}`}
                  />
                ))}
                <span className={styles.note}>last {ready.runs.length} checks</span>
              </div>
            )}
          </section>
        </div>
      </div>

      <Link href="/guide" className={styles.guidePointer}>
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
    </div>
  );
}
