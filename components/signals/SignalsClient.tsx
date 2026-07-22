"use client";

/* Live paper-signal terminal. Reads the signals / zones / engine_runs tables
   the scheduled engine writes to Supabase, plus the delayed quote feed for
   zone distances. Signature element: the session heartbeat — market clock,
   countdown to the next engine pass, and today's pace toward the 2-3
   signals/day target, over a tape of the trading day. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getSupabase,
  type EngineRunRow,
  type SignalRow,
  type ZoneRow,
} from "@/lib/supabase/client";
import { fetchMarket } from "@/lib/data/fetch";
import { nyMeta } from "@/lib/time/ny";
import {
  ago,
  fmtCountdown,
  fmtStamp,
  fmtTime,
  marketPhase,
  nextRunSec,
  tapeProgress,
} from "@/lib/time/session";
import { dayKeyLabel, etWindowLabel, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { money } from "@/lib/format";
import { Badge, Button, DataTable, Kpi, Panel, Tabs } from "@/components/ui";
import styles from "./signals.module.css";

const REFRESH_MS = 60_000;
const STALE_AFTER_MIN = 40; // two missed 15-min cron slots + jitter
const TARGET_PER_DAY = 3; // pace dots: the 2-3 signals/day goal

function statusBadge(s: SignalRow["status"]) {
  switch (s) {
    case "hit_target":
      return <Badge tone="green">TARGET</Badge>;
    case "hit_stop":
      return <Badge tone="red">STOP</Badge>;
    case "triggered":
      return <Badge tone="blue">OPEN</Badge>;
    case "pending":
      return <Badge tone="amber">PENDING</Badge>;
    case "expired":
      return <Badge>FLAT CLOSE</Badge>;
    default:
      return <Badge>{s.toUpperCase()}</Badge>;
  }
}

/* ── Sparkline (inline SVG, no dependencies) ────────────────────────── */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 600;
  const H = 56;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const up = last >= 0;
  const stroke = up ? "var(--green)" : "var(--red)";
  return (
    <div className={styles.spark} role="img" aria-label={`Cumulative P&L ${money(last)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "rgba(45,212,160,0.25)" : "rgba(255,107,122,0.25)"} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeDasharray="3 5" strokeWidth="1" />
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#sparkFill)" stroke="none" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill={stroke} />
      </svg>
      <span className={`${styles.sparkLast} ${up ? styles.good : styles.bad}`}>{money(last)}</span>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; signals: SignalRow[]; zones: ZoneRow[]; runs: EngineRunRow[] };

export default function SignalsClient() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tierTab, setTierTab] = useState("all");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const { zone } = useZone();

  useEffect(() => {
    try {
      if (!localStorage.getItem("aegis.guideSeen.v1")) setShowIntro(true);
    } catch {
      /* private mode — skip */
    }
  }, []);

  const dismissIntro = () => {
    setShowIntro(false);
    try {
      localStorage.setItem("aegis.guideSeen.v1", "1");
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [signals, zones, runs] = await Promise.all([
        supabase.from("signals").select("*").order("signal_ts", { ascending: false }).limit(200),
        supabase.from("zones").select("*").limit(120),
        supabase.from("engine_runs").select("*").order("ran_at", { ascending: false }).limit(5),
      ]);
      const err = signals.error || zones.error || runs.error;
      if (err) throw new Error(err.message);
      setState({
        status: "ready",
        signals: (signals.data ?? []) as SignalRow[],
        zones: (zones.data ?? []) as ZoneRow[],
        runs: (runs.data ?? []) as EngineRunRow[],
      });
      setLoadedAt(Date.now());
    } catch (e) {
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "error", error: e instanceof Error ? e.message : String(e) }
      );
    }
    // Delayed quotes give the zone-distance column; best effort.
    for (const symbol of ["MES", "MNQ"] as const) {
      fetchMarket(symbol)
        .then((q) => setPrices((p) => ({ ...p, [symbol]: q.price })))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const ready = state.status === "ready" ? state : null;
  const lastRun = ready?.runs[0] ?? null;
  const engineStale =
    !lastRun || Date.now() - new Date(lastRun.ran_at).getTime() > STALE_AFTER_MIN * 60_000;

  const phase = marketPhase(nowSec);
  const nextRun = nextRunSec(nowSec);
  const tape = tapeProgress(nowSec);
  const todayKey = nyMeta(nowSec).dateKey;
  const todayCount = useMemo(
    () =>
      (ready?.signals ?? []).filter(
        (s) => nyMeta(Math.floor(new Date(s.signal_ts).getTime() / 1000)).dateKey === todayKey
      ).length,
    [ready, todayKey]
  );

  /* Performance across the loaded window (up to 200 signals). */
  const perf = useMemo(() => {
    if (!ready) return null;
    const closed = ready.signals
      .filter((s) => s.pnl_usd !== null)
      .sort((a, b) => (a.exit_ts ?? a.signal_ts).localeCompare(b.exit_ts ?? b.signal_ts));
    let acc = 0;
    const curve = closed.map((s) => (acc += s.pnl_usd ?? 0));
    const week = ready.signals.filter(
      (s) => Date.now() - new Date(s.signal_ts).getTime() < 7 * 86400_000
    );
    const weekClosed = week.filter((s) => s.pnl_usd !== null);
    const tier = (t: "A" | "B") => {
      const rows = ready.signals.filter((s) => s.tier === t);
      const done = rows.filter((s) => s.pnl_usd !== null);
      const wins = done.filter((s) => (s.pnl_usd ?? 0) > 0).length;
      return {
        total: rows.length,
        closed: done.length,
        wins,
        winRate: done.length ? (wins / done.length) * 100 : null,
        net: done.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
        open: rows.filter((s) => s.status === "triggered").length,
      };
    };
    return {
      curve,
      net: acc,
      weekCount: week.length,
      weekPerDay: week.length / 5,
      weekWinRate: weekClosed.length
        ? (weekClosed.filter((s) => (s.pnl_usd ?? 0) > 0).length / weekClosed.length) * 100
        : null,
      weekNet: weekClosed.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
      A: tier("A"),
      B: tier("B"),
    };
  }, [ready]);

  /* Blotter: signals grouped by NY day, newest day first. */
  const days = useMemo(() => {
    const visible = !ready
      ? []
      : tierTab === "all"
        ? ready.signals
        : ready.signals.filter((s) => s.tier === tierTab);
    const map = new Map<string, { label: string; rows: SignalRow[]; net: number; open: number }>();
    for (const s of visible) {
      const t = Math.floor(new Date(s.signal_ts).getTime() / 1000);
      const key = nyMeta(t).dateKey;
      let g = map.get(key);
      if (!g) {
        g = { label: dayKeyLabel(key), rows: [], net: 0, open: 0 };
        map.set(key, g);
      }
      g.rows.push(s);
      g.net += s.pnl_usd ?? 0;
      if (s.status === "triggered") g.open++;
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ready, tierTab]);

  /* Zones ranked by distance from the delayed price. */
  const rankedZones = useMemo(() => {
    const zones = ready?.zones ?? [];
    const withDist = zones.map((z) => {
      const price = prices[z.symbol];
      if (!price) return { z, dist: null as number | null, above: false, inside: false };
      if (price >= z.price_low && price <= z.price_high)
        return { z, dist: 0, above: false, inside: true };
      const above = z.price_low > price; // zone sits above current price
      const edge = above ? z.price_low : z.price_high;
      return { z, dist: (Math.abs(edge - price) / price) * 100, above, inside: false };
    });
    return withDist.sort((a, b) => {
      if (a.dist === null) return 1;
      if (b.dist === null) return -1;
      return a.dist - b.dist;
    });
  }, [ready, prices]);

  return (
    <>
      <h1 className="pageTitle">Signals</h1>
      <p className="pageSub">
        Tier A = high-conviction zone setups · Tier B = daily RSI flow. Delayed data, paper
        simulation — a log to study, never execution instructions.
      </p>

      {showIntro && (
        <div className={styles.intro} role="note">
          <span>
            <b>New here?</b> The 5-minute guide explains the signals, the two tiers, and the daily
            routine — in trading language, not tech.
          </span>
          <span className={styles.introActions}>
            <Link href="/guide" className={styles.introLink} onClick={dismissIntro}>
              Read the guide
            </Link>
            <button className={styles.introClose} onClick={dismissIntro} aria-label="Dismiss">
              ✕
            </button>
          </span>
        </div>
      )}

      {/* ── Session heartbeat ── */}
      <section className={styles.hero} aria-label="Session status">
        <div className={styles.heroCell}>
          <span className={`${styles.phaseDot} ${styles[phase.tone]} ${phase.live ? styles.phaseLive : ""}`} />
          <div>
            <div className={styles.heroValue}>{phase.label}</div>
            <div className={styles.heroDetail}>{phase.detail}</div>
          </div>
        </div>
        <div className={styles.heroCell}>
          <div>
            <div className={`${styles.heroValue} num`}>{fmtCountdown(Math.max(0, nextRun - nowSec))}</div>
            <div className={styles.heroDetail}>
              next engine pass ·{" "}
              {lastRun ? (
                <span className={lastRun.status === "ok" ? (engineStale ? styles.warn : styles.good) : styles.bad}>
                  last {lastRun.status === "ok" ? "ok" : "failed"} {ago(lastRun.ran_at)}
                </span>
              ) : (
                "no runs yet"
              )}
            </div>
          </div>
        </div>
        <div className={styles.heroCell}>
          <div>
            <div className={styles.heroValue}>
              <span className="num">{todayCount}</span>
              <span className={styles.paceDots} aria-hidden>
                {Array.from({ length: TARGET_PER_DAY }, (_, i) => (
                  <i key={i} className={i < todayCount ? styles.paceOn : styles.paceOff} />
                ))}
              </span>
            </div>
            <div className={styles.heroDetail}>signals today · target 2–3</div>
          </div>
        </div>
        <div className={styles.heroSide}>
          <Button small variant="ghost" onClick={load} aria-label="Refresh data">
            ↻ {loadedAt ? `${Math.max(0, Math.round((Date.now() - loadedAt) / 1000))}s` : ""}
          </Button>
        </div>
        {tape !== null && (
          <div className={styles.tape} aria-hidden>
            <div className={styles.tapeFill} style={{ width: `${(tape * 100).toFixed(2)}%` }} />
            <span className={styles.tapeMark} style={{ left: `${(tape * 100).toFixed(2)}%` }} />
          </div>
        )}
      </section>

      {state.status === "error" && (
        <Panel title="Connection">
          <div className={styles.error}>
            Signal feed unreachable ({state.error}). Retrying every minute — check your network or
            the Supabase project.
          </div>
        </Panel>
      )}

      {/* ── Performance ── */}
      {perf && (
        <Panel title="Performance" hint="closed simulated signals, costs included">
          <div className={styles.kpis}>
            <Kpi label="7-day signals" value={String(perf.weekCount)} sub={`≈ ${perf.weekPerDay.toFixed(1)} / trading day`} />
            <Kpi
              label="7-day win rate"
              value={perf.weekWinRate === null ? "—" : `${perf.weekWinRate.toFixed(0)}%`}
              tone={perf.weekWinRate !== null && perf.weekWinRate >= 50 ? "good" : undefined}
            />
            <Kpi label="7-day net" value={money(perf.weekNet)} tone={perf.weekNet >= 0 ? "good" : "bad"} />
            <Kpi label="Window net" value={money(perf.net)} tone={perf.net >= 0 ? "good" : "bad"} sub={`last ${perf.curve.length} closed`} />
          </div>
          <Sparkline values={perf.curve} />
          <div className={styles.tierGrid}>
            {(["A", "B"] as const).map((t) => {
              const s = perf[t];
              return (
                <div key={t} className={styles.tierCard}>
                  <div className={styles.tierHead}>
                    <Badge tone={t === "A" ? "blue" : "amber"}>TIER {t}</Badge>
                    <span className={styles.tierName}>
                      {t === "A" ? "Zone Engine v5 · high conviction" : "RSI reversion · daily flow"}
                    </span>
                  </div>
                  <div className={styles.tierStats}>
                    <span>
                      <b className="num">{s.total}</b> signals
                      {s.open > 0 && <em className={styles.tierOpen}> · {s.open} open</em>}
                    </span>
                    <span>
                      WR <b className="num">{s.winRate === null ? "—" : `${s.winRate.toFixed(0)}%`}</b>
                    </span>
                    <span className={s.net >= 0 ? styles.good : styles.bad}>
                      <b className="num">{money(s.net)}</b>
                    </span>
                  </div>
                  {s.closed > 0 && (
                    <div className={styles.wlBar} aria-hidden>
                      <i style={{ flexGrow: s.wins }} />
                      <i style={{ flexGrow: Math.max(0, s.closed - s.wins) }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ── Blotter ── */}
      <Panel
        title="Signal blotter"
        hint={`grouped by New York trading day · times in ${ZONE_ABBR[zone]}`}
        actions={
          <Tabs
            tabs={[
              { id: "all", label: "All" },
              { id: "A", label: "Tier A" },
              { id: "B", label: "Tier B" },
            ]}
            active={tierTab}
            onChange={setTierTab}
          />
        }
      >
        {days.length === 0 && (
          <div className={styles.emptyNote}>
            {state.status === "loading"
              ? "Loading…"
              : "No signals in this view yet — the engine writes them as setups trigger."}
          </div>
        )}
        {days.map(([key, day]) => (
          <div key={key} className={styles.dayGroup}>
            <div className={styles.dayHead}>
              <span className={styles.dayLabel}>{day.label}</span>
              <span className={styles.dayMeta}>
                {day.rows.length} signal{day.rows.length === 1 ? "" : "s"}
                {day.open > 0 && ` · ${day.open} open`}
              </span>
              <span className={`${styles.dayNet} num ${day.net >= 0 ? styles.good : styles.bad}`}>
                {money(day.net)}
              </span>
            </div>
            <DataTable
              columns={[`Time (${ZONE_ABBR[zone]})`, "Tier", "Symbol", "Side", "Entry", "Stop", "Target", "R:R", "Status", "P&L", "Setup"]}
              rows={day.rows.map((s) => [
                <span key="t" className="num">{fmtTime(s.signal_ts, zone)}</span>,
                <Badge key="b" tone={s.tier === "A" ? "blue" : "amber"}>{s.tier}</Badge>,
                s.symbol,
                s.direction === "long" ? "LONG" : "SHORT",
                s.entry_price.toFixed(2),
                s.stop_price.toFixed(2),
                s.target_price?.toFixed(2) ?? "—",
                s.rr?.toFixed(1) ?? "—",
                statusBadge(s.status),
                s.pnl_usd === null ? (
                  "—"
                ) : (
                  <span key="p" className={s.pnl_usd >= 0 ? styles.good : styles.bad}>{money(s.pnl_usd)}</span>
                ),
                <span key="r" className={styles.dim}>{s.reason ?? "—"}</span>,
              ])}
              mobileCards={{ titleIndexes: [1, 2, 3, 8], hideIndexes: [10] }}
            />
          </div>
        ))}
      </Panel>

      {/* ── Zones ── */}
      <Panel
        title="Zone watchlist"
        hint="demand/supply stacks from NY-session structure · nearest to price first"
      >
        <DataTable
          columns={["Symbol", "TF", "Type", "Zone", "Distance", "State", "Formed"]}
          rows={rankedZones.map(({ z, dist, above, inside }) => [
            z.symbol,
            z.timeframe,
            z.zone_type === "demand" ? (
              <Badge key="d" tone="green">DEMAND</Badge>
            ) : (
              <Badge key="s" tone="red">SUPPLY</Badge>
            ),
            <span key="z" className="num">{`${z.price_low.toFixed(2)} – ${z.price_high.toFixed(2)}`}</span>,
            inside ? (
              <Badge key="at" tone="amber">AT ZONE</Badge>
            ) : dist === null ? (
              <span className={styles.dim}>—</span>
            ) : (
              <span key="di" className={`num ${dist < 0.5 ? styles.warn : styles.dim}`}>
                {dist.toFixed(1)}% {above ? "above" : "below"}
              </span>
            ),
            <span key="st">
              {z.fresh ? <Badge tone="blue">FRESH</Badge> : <Badge>TESTED</Badge>}{" "}
              {z.achieved ? <Badge tone="green">ACHIEVED</Badge> : null}
              {z.blocked80 ? <Badge tone="amber">80% BLOCK</Badge> : null}
            </span>,
            fmtStamp(z.source_candle_ts, zone),
          ])}
          empty={state.status === "loading" ? "Loading…" : "No zones snapshotted yet."}
          mobileCards={{ titleIndexes: [0, 2, 4], hideIndexes: [6] }}
        />
      </Panel>

      {/* ── Engine detail ── */}
      <Panel
        title="Engine"
        hint={`GitHub Actions · every 15 min · ${etWindowLabel("02:00", "15:25")} entry window`}
        actions={
          lastRun ? (
            <Badge tone={lastRun.status === "ok" ? (engineStale ? "amber" : "green") : "red"}>
              {lastRun.status === "ok" ? (engineStale ? "IDLE / STALE" : "RUNNING") : "ERROR"}
            </Badge>
          ) : undefined
        }
      >
        {lastRun ? (
          <div className={styles.kpis}>
            <Kpi label="Last run" value={ago(lastRun.ran_at)} sub={fmtStamp(lastRun.ran_at, zone)} />
            <Kpi
              label="Result"
              value={lastRun.status.toUpperCase()}
              tone={lastRun.status === "ok" ? "good" : "bad"}
              sub={lastRun.message ?? undefined}
            />
            <Kpi
              label="Rows written"
              value={`${lastRun.signals_created ?? 0} signals`}
              sub={`${lastRun.zones_upserted ?? 0} zones`}
            />
            <Kpi
              label="Duration"
              value={lastRun.duration_ms ? `${(lastRun.duration_ms / 1000).toFixed(1)}s` : "—"}
              sub={lastRun.source ?? undefined}
            />
          </div>
        ) : (
          <div className={styles.dim}>No engine runs recorded yet.</div>
        )}
        {ready && ready.runs.length > 1 && (
          <div className={styles.runDots}>
            {[...ready.runs].reverse().map((r) => (
              <span
                key={r.id}
                className={r.status === "ok" ? styles.runOk : styles.runBad}
                title={`${fmtStamp(r.ran_at, zone)} · ${r.status}`}
              />
            ))}
            <span className={styles.dim}>last {ready.runs.length} runs</span>
          </div>
        )}
      </Panel>
    </>
  );
}
