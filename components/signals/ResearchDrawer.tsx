"use client";

/* "For researchers" on the Ideas screen: the raw numbers behind the cards.

   Collapsed by default but on the same page as the cards — the methods'
   verdict is stated in plain words above it, and nothing here is moved to
   another tab (design-language §9: a refutation is never de-emphasised).
   Every rate goes through Rate / Kpi n= and keeps its sample count. Ported
   from the pre-redesign Signals page; the 960px blotter is now a DataTable
   that restacks as cards on a phone, and the zone list moved to Chart. */

import { useMemo, useState } from "react";
import type { BotPolicyRow, EngineRunRow, SignalRow } from "@/lib/neon/client";
import { streamKeyForRow, streamLabel } from "@/lib/engine/streams";
import { STALE_BAR_AGE_MIN, STALE_LABEL } from "@/lib/signals/freshness";
import { describeSetup } from "@/lib/signals/context";
import { visibleSignals } from "@/lib/signals/snapshot";
import { nyMeta } from "@/lib/time/ny";
import { ago, fmtStamp, fmtTime } from "@/lib/time/session";
import { dayKeyLabel, etWindowLabel, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { money } from "@/lib/format";
import { fmtPf, profitFactor, rateReadout } from "@/lib/stats";
import { Badge, DataTable, Kpi, Panel, Rate, Tabs } from "@/components/ui";
import styles from "./signals.module.css";

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
    case "closed_win":
      return <Badge tone="green">CLOSED UP</Badge>;
    case "expired":
      return <Badge>FLAT CLOSE</Badge>;
    default:
      return <Badge>{s.toUpperCase()}</Badge>;
  }
}

/* A clean fill renders nothing; only problems are labelled (design-language §5). */
function fillChip(fc: SignalRow["fill_confidence"]) {
  if (fc === "marginal") return <Badge tone="amber">MARGINAL FILL</Badge>;
  if (fc === "doubtful") return <Badge tone="red">DOUBTFUL FILL</Badge>;
  return null;
}

/* Net + PF over closed rows, excluding doubtful fills — the honest restatement. */
function exDoubtful(rows: SignalRow[]): { net: number; pf: number | null; n: number } {
  const closed = rows.filter((s) => s.pnl_usd !== null && s.fill_confidence !== "doubtful");
  const pnls = closed.map((s) => s.pnl_usd ?? 0);
  return { net: pnls.reduce((a, v) => a + v, 0), pf: profitFactor(pnls), n: closed.length };
}

const REGIME_ORDER = ["trend-high-vol", "trend-low-vol", "range-high-vol", "range-low-vol"];
const REGIME_LABEL: Record<string, string> = {
  "trend-high-vol": "Trending, busy market",
  "trend-low-vol": "Trending, quiet market",
  "range-high-vol": "Choppy, busy market",
  "range-low-vol": "Choppy, quiet market",
};

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
  const stroke = last >= 0 ? "var(--green)" : "var(--red)";
  return (
    <div className={styles.spark} role="img" aria-label={`Running total ${money(last)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeDasharray="3 5" strokeWidth="1" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill={stroke} />
      </svg>
      <span className={`${styles.sparkLast} ${last >= 0 ? styles.good : styles.bad}`}>{money(last)}</span>
    </div>
  );
}

export default function ResearchDrawer({
  rows,
  orphaned,
  runs,
  policy,
}: {
  rows: SignalRow[];
  orphaned: SignalRow[];
  runs: EngineRunRow[];
  policy: BotPolicyRow[];
}) {
  const { zone } = useZone();
  const [tierTab, setTierTab] = useState("all");
  const lastRun = runs[0] ?? null;

  const perf = useMemo(() => {
    const active = visibleSignals(rows);
    const closed = active
      .filter((s) => s.pnl_usd !== null)
      .sort((a, b) => (a.exit_ts ?? a.signal_ts).localeCompare(b.exit_ts ?? b.signal_ts));
    let acc = 0;
    const curve = closed.map((s) => (acc += s.pnl_usd ?? 0));
    const week = active.filter((s) => Date.now() - new Date(s.signal_ts).getTime() < 7 * 86400_000);
    const weekClosed = week.filter((s) => s.pnl_usd !== null);
    const slice = (subset: SignalRow[]) => {
      const done = subset.filter((s) => s.pnl_usd !== null);
      const wins = done.filter((s) => (s.pnl_usd ?? 0) > 0).length;
      return {
        total: subset.length,
        closed: done.length,
        wins,
        rate: rateReadout(wins, done.length),
        net: done.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
        ex: exDoubtful(subset),
      };
    };
    return {
      curve,
      net: acc,
      weekCount: week.length,
      weekRate: rateReadout(weekClosed.filter((s) => (s.pnl_usd ?? 0) > 0).length, weekClosed.length),
      weekNet: weekClosed.reduce((a, s) => a + (s.pnl_usd ?? 0), 0),
      weekEx: exDoubtful(week),
      windowEx: exDoubtful(active),
      A: slice(active.filter((s) => s.tier === "A")),
      B: slice(active.filter((s) => s.tier === "B")),
      regimes: REGIME_ORDER.map((key) => ({ key, ...slice(active.filter((s) => s.regime === key)) })).filter(
        (r) => r.total > 0
      ),
    };
  }, [rows]);

  /* Streams the breaker has benched: each stream's latest bot_policy row is a pause. */
  const pausedStreams = useMemo(() => {
    const latest = new Map<string, BotPolicyRow>();
    for (const p of policy) if (!latest.has(p.stream)) latest.set(p.stream, p);
    return [...latest.entries()]
      .filter(([, p]) => p.action === "paused")
      .map(([stream, p]) => {
        const recent = rows
          .filter((s) => s.suppressed && s.pnl_usd !== null && s.fill_confidence !== "doubtful" && streamKeyForRow(s) === stream)
          .slice(0, 15);
        return { stream, since: p.changed_at, reason: p.reason, recoveryPf: profitFactor(recent.map((s) => s.pnl_usd ?? 0)), n: recent.length };
      });
  }, [policy, rows]);

  const staleRows = useMemo(() => rows.filter((s) => s.stale_data), [rows]);

  const blotter = useMemo(() => {
    const visible = rows.filter((s) => !s.suppressed && (tierTab === "all" || s.tier === tierTab));
    return visible.map((s) => [
      <span key="d" className="num">
        {dayKeyLabel(nyMeta(Math.floor(Date.parse(s.signal_ts) / 1000)).dateKey)} {fmtTime(s.signal_ts, zone)}
      </span>,
      <Badge key="t" tone={s.tier === "A" ? "blue" : "amber"}>
        {s.tier === "A" ? "Zone" : "Daily"}
      </Badge>,
      <b key="s">{s.symbol}</b>,
      <span key="side" className={s.direction === "long" ? styles.sideBuy : styles.sideSell}>
        {s.direction === "long" ? "BUY" : "SELL"}
      </span>,
      <span key="lv" className="num">
        {s.entry_price.toFixed(2)} / {s.stop_price.toFixed(2)} / {s.target_price?.toFixed(2) ?? "—"}
      </span>,
      <span key="st" className={styles.statusWrap}>
        {statusBadge(s.status)} {fillChip(s.fill_confidence)}
      </span>,
      s.pnl_usd === null ? (
        <span key="p" className={styles.dim}>
          —
        </span>
      ) : (
        <span key="p" className={`num ${s.pnl_usd >= 0 ? styles.good : styles.bad}`}>
          {money(s.pnl_usd)}
        </span>
      ),
      <span key="r" className={styles.dim}>
        {s.regime ? REGIME_LABEL[s.regime] ?? s.regime : "—"}
      </span>,
      <span key="w" className={styles.dim}>
        {describeSetup(s)}
      </span>,
    ]);
  }, [rows, tierTab, zone]);

  return (
    <div className={styles.drawer}>
      <Panel title="Results of closed ideas" hint="simulated, after costs">
        <div className={styles.kpis}>
          <Kpi label="Ideas, last 7 days" value={String(perf.weekCount)} />
          <Kpi
            label="Win rate, 7 days"
            value={perf.weekRate.valueLabel}
            tone={perf.weekRate.value !== null && perf.weekRate.value >= 50 ? "good" : undefined}
            n={perf.weekRate.n}
            ci={perf.weekRate.ciLabel}
          />
          <Kpi label="Net, 7 days" value={money(perf.weekNet)} tone={perf.weekNet >= 0 ? "good" : "bad"} n={perf.weekRate.n} />
          <Kpi label="Net, all loaded" value={money(perf.net)} tone={perf.net >= 0 ? "good" : "bad"} sub={`last ${perf.curve.length} closed`} />
        </div>
        <p className={styles.dim}>
          Leaving out doubtful fills — 7 days: profit factor {fmtPf(perf.weekEx.pf)} · net {money(perf.weekEx.net)} · all
          loaded: profit factor {fmtPf(perf.windowEx.pf)} · net {money(perf.windowEx.net)}
        </p>
        <Sparkline values={perf.curve} />
        <div className={styles.tierGrid}>
          {(["A", "B"] as const).map((t) => {
            const s = perf[t];
            return (
              <div key={t} className={styles.tierCard}>
                <div className={styles.tierHead}>
                  <Badge tone={t === "A" ? "blue" : "amber"}>{t === "A" ? "ZONE SETUP" : "DAILY FLOW"}</Badge>
                  <span className={styles.tierName}>{t === "A" ? "Zone Engine v5" : "RSI reversion"}</span>
                </div>
                <div className={styles.tierStats}>
                  <span>
                    <b className="num">{s.total}</b> ideas
                  </span>
                  <span>
                    Win rate <Rate readout={s.rate} valueClassName="num" />
                  </span>
                  <span className={s.net >= 0 ? styles.good : styles.bad}>
                    <b className="num">{money(s.net)}</b>
                  </span>
                </div>
                <div className={styles.dim}>
                  Leaving out doubtful fills: profit factor {fmtPf(s.ex.pf)} · {money(s.ex.net)}
                </div>
              </div>
            );
          })}
        </div>
        {perf.regimes.length > 0 && (
          <div className={styles.tierGrid}>
            {perf.regimes.map((r) => (
              <div key={r.key} className={styles.tierCard}>
                <div className={styles.tierHead}>
                  <span className={styles.tierName}>{REGIME_LABEL[r.key] ?? r.key} at entry</span>
                </div>
                <div className={styles.tierStats}>
                  <span>
                    <b className="num">{r.total}</b> ideas
                  </span>
                  <span>
                    Win rate <Rate readout={r.rate} valueClassName="num" />
                  </span>
                  <span className={r.net >= 0 ? styles.good : styles.bad}>
                    <b className="num">{money(r.net)}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {pausedStreams.length > 0 && (
        <Panel title="Paused by the breaker" hint="still simulating, left out of the numbers above">
          <DataTable
            columns={["Kind of idea", "Paused since", "Why", "Recovering"]}
            rows={pausedStreams.map((p) => [
              <span key="s">
                <Badge tone="amber">PAUSED</Badge> {streamLabel(p.stream)}
              </span>,
              fmtStamp(p.since, zone),
              <span key="r" className={styles.dim}>
                {p.reason ?? "—"}
              </span>,
              p.n === 0 ? "no closed practice ideas yet" : `profit factor ${fmtPf(p.recoveryPf)} over ${p.n} (resumes at 1.1 over 15)`,
            ])}
            mobileCards={{ titleIndexes: [0] }}
          />
        </Panel>
      )}

      {staleRows.length > 0 && (
        <Panel title="Left out: stale prices" hint={`worked out from prices over ${STALE_BAR_AGE_MIN} min old`}>
          <DataTable
            columns={["When", "Kind", "Market", "Side", "Result", "Result $"]}
            rows={staleRows.map((s) => [
              fmtStamp(s.signal_ts, zone),
              <span key="t">
                <Badge tone="amber">{STALE_LABEL}</Badge> {s.tier}
              </span>,
              s.symbol,
              s.direction === "long" ? "BUY" : "SELL",
              statusBadge(s.status),
              <span key="p" className="num">
                {s.pnl_usd === null ? "—" : money(s.pnl_usd)}
              </span>,
            ])}
            mobileCards={{ titleIndexes: [0, 2] }}
          />
        </Panel>
      )}

      {orphaned.length > 0 && (
        <Panel title="Left out: revised away" hint="kept as a record — the latest recompute no longer produces them">
          <DataTable
            columns={["When", "Kind", "Market", "Side", "Old result", "Old $"]}
            rows={orphaned.map((s) => [
              fmtStamp(s.signal_ts, zone),
              <span key="t">
                <Badge tone="amber">REVISED</Badge> {s.tier}
              </span>,
              s.symbol,
              s.direction === "long" ? "BUY" : "SELL",
              statusBadge(s.status),
              <span key="p" className="num">
                {s.pnl_usd === null ? "—" : money(s.pnl_usd)}
              </span>,
            ])}
            mobileCards={{ titleIndexes: [0, 2] }}
          />
        </Panel>
      )}

      <Panel
        title="Every idea"
        hint={`times in ${ZONE_ABBR[zone]} · entry / stop / target`}
        actions={
          <Tabs
            tabs={[
              { id: "all", label: "All" },
              { id: "A", label: "Zone" },
              { id: "B", label: "Daily" },
            ]}
            active={tierTab}
            onChange={setTierTab}
          />
        }
      >
        <DataTable
          columns={["When", "Kind", "Market", "Side", "Levels", "Status", "Result", "Market mood", "Setup"]}
          rows={blotter}
          empty="No ideas in this view yet."
          mobileCards={{ titleIndexes: [0, 2, 3], hideIndexes: [7] }}
        />
      </Panel>

      <Panel title="Engine" hint={`runs every 15 min all Globex week · new ideas only ${etWindowLabel("02:00", "15:25")}`}>
        {lastRun ? (
          <div className={styles.kpis}>
            <Kpi label="Last check" value={ago(lastRun.ran_at)} sub={fmtStamp(lastRun.ran_at, zone)} />
            <Kpi label="Result" value={lastRun.status.toUpperCase()} tone={lastRun.status === "ok" ? "good" : "bad"} />
            <Kpi label="Rows written" value={`${lastRun.signals_created ?? 0} ideas`} sub={`${lastRun.zones_upserted ?? 0} zones`} />
            <Kpi label="Took" value={lastRun.duration_ms ? `${(lastRun.duration_ms / 1000).toFixed(1)}s` : "—"} />
          </div>
        ) : (
          <div className={styles.dim}>No engine runs recorded yet.</div>
        )}
        {lastRun?.message && <p className={styles.engineMessage}>{lastRun.message}</p>}
        {runs.length > 1 && (
          <div className={styles.runDots}>
            {[...runs].reverse().map((r) => (
              <span key={r.id} className={r.status === "ok" ? styles.runOk : styles.runBad} title={`${fmtStamp(r.ran_at, zone)} · ${r.status}`} />
            ))}
            <span className={styles.dim}>last {runs.length} checks</span>
          </div>
        )}
      </Panel>
    </div>
  );
}
