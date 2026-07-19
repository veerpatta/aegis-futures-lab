"use client";

/* Live paper-signal dashboard: reads the signals / zones / engine_runs
   tables the scheduled engine (scripts/engine/run-live.ts) writes to
   Supabase. Read-only; refreshes every 60s. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSupabase,
  type EngineRunRow,
  type SignalRow,
  type ZoneRow,
} from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { Badge, DataTable, Kpi, Panel, Tabs } from "@/components/ui";
import styles from "./signals.module.css";

const REFRESH_MS = 60_000;
const STALE_AFTER_MIN = 40; // two missed 15-min cron slots + jitter

const nyTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmtEt(isoOrNull: string | null): string {
  if (!isoOrNull) return "—";
  return `${nyTime.format(new Date(isoOrNull))} ET`;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

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

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; signals: SignalRow[]; zones: ZoneRow[]; runs: EngineRunRow[] };

export default function SignalsClient() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tierTab, setTierTab] = useState("all");

  const load = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [signals, zones, runs] = await Promise.all([
        supabase
          .from("signals")
          .select("*")
          .order("signal_ts", { ascending: false })
          .limit(100),
        supabase
          .from("zones")
          .select("*")
          .order("symbol")
          .order("timeframe")
          .limit(120),
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
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const ready = state.status === "ready" ? state : null;
  const lastRun = ready?.runs[0] ?? null;
  const engineStale =
    !lastRun || Date.now() - new Date(lastRun.ran_at).getTime() > STALE_AFTER_MIN * 60_000;

  const visibleSignals = useMemo(() => {
    if (!ready) return [];
    return tierTab === "all" ? ready.signals : ready.signals.filter((s) => s.tier === tierTab);
  }, [ready, tierTab]);

  const week = useMemo(() => {
    if (!ready) return null;
    const cutoff = Date.now() - 7 * 86400_000;
    const recent = ready.signals.filter((s) => new Date(s.signal_ts).getTime() >= cutoff);
    const closed = recent.filter((s) => s.pnl_usd !== null);
    const wins = closed.filter((s) => (s.pnl_usd ?? 0) > 0).length;
    const net = closed.reduce((a, s) => a + (s.pnl_usd ?? 0), 0);
    return {
      count: recent.length,
      a: recent.filter((s) => s.tier === "A").length,
      b: recent.filter((s) => s.tier === "B").length,
      perDay: recent.length / 5,
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      net,
    };
  }, [ready]);

  return (
    <>
      <h1 className="pageTitle">Signals</h1>
      <p className="pageSub">
        Scheduled paper-signal engine on the free delayed feed — research log, never execution-grade.
        Tier A = high-conviction zone setups; tier B = daily RSI mean-reversion flow.
      </p>

      {state.status === "error" && (
        <Panel title="Connection">
          <div className={styles.error}>Supabase unreachable: {state.error}</div>
        </Panel>
      )}

      <Panel
        title="Engine"
        hint="GitHub Actions · every 15 min, 02:00–15:25 ET entry window"
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
            <Kpi label="Last run" value={ago(lastRun.ran_at)} sub={fmtEt(lastRun.ran_at)} />
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
      </Panel>

      {week && (
        <Panel title="Last 7 days" hint="closed simulated signals, costs included">
          <div className={styles.kpis}>
            <Kpi
              label="Signals"
              value={String(week.count)}
              sub={`≈ ${week.perDay.toFixed(1)} per trading day`}
            />
            <Kpi label="Tier split" value={`A ${week.a} · B ${week.b}`} />
            <Kpi
              label="Win rate"
              value={week.winRate === null ? "—" : `${week.winRate.toFixed(0)}%`}
              tone={week.winRate !== null && week.winRate >= 50 ? "good" : undefined}
            />
            <Kpi
              label="Net P&L"
              value={money(week.net)}
              tone={week.net >= 0 ? "good" : "bad"}
            />
          </div>
        </Panel>
      )}

      <Panel
        title="Signal log"
        hint="latest 100 · times in ET"
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
        <DataTable
          columns={["Time", "Tier", "Symbol", "Side", "Entry", "Stop", "Target", "R:R", "Status", "P&L", "Setup"]}
          rows={visibleSignals.map((s) => [
            fmtEt(s.signal_ts),
            <Badge key="t" tone={s.tier === "A" ? "blue" : "amber"}>
              {s.tier}
            </Badge>,
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
              <span key="p" className={s.pnl_usd >= 0 ? styles.good : styles.bad}>
                {money(s.pnl_usd)}
              </span>
            ),
            <span key="r" className={styles.dim}>
              {s.reason ?? "—"}
            </span>,
          ])}
          empty={
            state.status === "loading"
              ? "Loading…"
              : "No signals yet — the engine writes them as setups trigger."
          }
          mobileCards={{ titleIndexes: [1, 2, 3, 8], hideIndexes: [10] }}
        />
      </Panel>

      <Panel
        title="Zone watchlist"
        hint="current demand/supply stacks (NY-session structure), nearest first"
      >
        <DataTable
          columns={["Symbol", "TF", "Type", "Zone", "State", "Formed"]}
          rows={(ready?.zones ?? []).map((z) => [
            z.symbol,
            z.timeframe,
            z.zone_type === "demand" ? (
              <Badge key="d" tone="green">
                DEMAND
              </Badge>
            ) : (
              <Badge key="s" tone="red">
                SUPPLY
              </Badge>
            ),
            `${z.price_low.toFixed(2)} – ${z.price_high.toFixed(2)}`,
            <span key="st">
              {z.fresh ? <Badge tone="blue">FRESH</Badge> : <Badge>TESTED</Badge>}{" "}
              {z.achieved ? <Badge tone="green">ACHIEVED</Badge> : null}
              {z.blocked80 ? <Badge tone="amber">80% BLOCK</Badge> : null}
            </span>,
            fmtEt(z.source_candle_ts),
          ])}
          empty={state.status === "loading" ? "Loading…" : "No zones snapshotted yet."}
          mobileCards={{ titleIndexes: [0, 1, 2] }}
        />
      </Panel>
    </>
  );
}
