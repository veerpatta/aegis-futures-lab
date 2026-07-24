"use client";

/* "What the bot knows" — renders the nightly learned_stats tables in plain
   language. Pure observation: nothing on this page is a trade idea, and none
   of it changes what the bot does. Paper only, delayed data. */

import { useEffect, useMemo, useState } from "react";
import { getSupabase, type LearnedStatsRow } from "@/lib/supabase/client";
import { Badge, DataTable, Kpi, Panel } from "@/components/ui";
import { money } from "@/lib/format";
import { fmtPf } from "@/lib/stats";
import styles from "./brain.module.css";

interface Cell {
  n: number;
  net: number;
  pf: number | null;
  winRate: number | null;
  insufficient: boolean;
}
interface Decile extends Cell {
  decile: number;
  scoreLo: number | null;
  scoreHi: number | null;
}
interface ScoreCal {
  real: { total: number; deciles: Decile[] };
  inclusive: { total: number; deciles: Decile[] };
  minCell: number;
}
interface ConditionLedger {
  tierRegime: Record<string, Cell>;
  tierVix: Record<string, Cell>;
  dayOfWeek: Record<string, Cell>;
  entryHour: Record<string, Cell>;
  minCell: number;
}
interface GateCost {
  reason: string;
  label: string;
  count: number;
  diagnostic: boolean;
}
interface GateCosts {
  lookbackDays: number;
  bars: Record<string, number>;
  gates: GateCost[];
  diagnostics: GateCost[];
  note: string;
}
interface FillReality {
  weeks: { week: string; clean: number; marginal: number; doubtful: number; untagged: number; total: number; doubtfulShare: number }[];
}
interface ShadowStream {
  strategy: string;
  symbol: string;
  closed: number;
  net: number;
  pf: number | null;
  winRate: number | null;
  exPf: number | null;
  exNet: number;
  regimesWithData: number;
  regimesPositive: number;
  promotable: boolean;
  checklist: { label: string; pass: boolean }[];
}
interface ShadowScoreboard {
  streams: ShadowStream[];
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; latest: Map<string, LearnedStatsRow> };

const MIN_CELL = 10;
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function cellNode(c: Cell | undefined, key: string) {
  if (!c) return <span key={key} className={styles.collecting}>—</span>;
  if (c.insufficient)
    return (
      <span key={key} className={styles.collecting}>
        collecting (n={c.n} of {MIN_CELL})
      </span>
    );
  return (
    <span key={key}>
      <span className="num">{money(c.net)}</span> · PF {fmtPf(c.pf)}
      {c.winRate === null ? "" : ` · ${c.winRate}%`} <span className={styles.dim}>(n={c.n})</span>
    </span>
  );
}

export default function BrainClient() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    getSupabase()
      .from("learned_stats")
      .select("*")
      .order("date_key", { ascending: false })
      .order("computed_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setState({ kind: "error", message: error.message });
          return;
        }
        const rows = (data ?? []) as LearnedStatsRow[];
        if (!rows.length) {
          setState({ kind: "empty" });
          return;
        }
        // rows are date_key-desc; first occurrence of each stat_key is newest.
        const latest = new Map<string, LearnedStatsRow>();
        for (const r of rows) if (!latest.has(r.stat_key)) latest.set(r.stat_key, r);
        setState({ kind: "ready", latest });
      });
  }, []);

  const asOf = useMemo(() => {
    if (state.kind !== "ready") return null;
    const dates = [...state.latest.values()].map((r) => r.date_key).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [state]);

  const intro = (
    <>
      <h1 className="pageTitle">What the bot knows</h1>
      <p className="pageSub">
        Every night the bot re-reads everything it has recorded and re-derives its own statistics.
        This page shows that knowledge in plain terms. It is pure observation — nothing here is a
        trade idea, and none of it changes what the bot does. Paper only, delayed data, never orders.
      </p>
    </>
  );

  if (state.kind === "loading")
    return (
      <>
        {intro}
        <Panel>
          <p className={styles.note}>Loading…</p>
        </Panel>
      </>
    );

  if (state.kind === "error")
    return (
      <>
        {intro}
        <Panel title="Not available yet">
          <p className={styles.note}>
            The knowledge tables are not readable yet ({state.message}). Once the nightly learn job
            has run at least once, its lessons appear here.
          </p>
        </Panel>
      </>
    );

  if (state.kind === "empty")
    return (
      <>
        {intro}
        <Panel title="Still collecting — first learn run pending">
          <p className={styles.note}>
            No knowledge rows have been written yet. The nightly job runs shortly after each New York
            close and fills these tables in. Check back after the next run.
          </p>
        </Panel>
      </>
    );

  const { latest } = state;
  const cal = latest.get("score_calibration")?.payload as ScoreCal | undefined;
  const ledger = latest.get("condition_ledger")?.payload as ConditionLedger | undefined;
  const gate = latest.get("gate_costs")?.payload as GateCosts | undefined;
  const fill = latest.get("fill_reality")?.payload as FillReality | undefined;
  const shadow = latest.get("shadow_scoreboard")?.payload as ShadowScoreboard | undefined;

  const ledgerPanel = (title: string, hint: string, explain: string, cells: Record<string, Cell> | undefined, order?: string[]) => {
    const keys = cells ? (order ? order.filter((k) => k in cells) : Object.keys(cells)) : [];
    return (
      <Panel title={title} hint={hint}>
        <p className={styles.note}>{explain}</p>
        <DataTable
          columns={["Bucket", "Result"]}
          rows={keys.map((k) => [<b key="k">{k}</b>, cellNode(cells![k], k)])}
          empty="collecting — no closed signals in these buckets yet."
        />
      </Panel>
    );
  };

  return (
    <>
      {intro}
      <div className={styles.asOf}>
        {asOf ? (
          <Badge tone="blue">as learned {asOf}</Badge>
        ) : (
          <Badge>collecting</Badge>
        )}
        <span className={styles.dim}>
          &nbsp;Cells with fewer than {MIN_CELL} closed signals read “collecting (n=X of {MIN_CELL})”
          — the bot will not judge them until the sample is real.
        </span>
      </div>

      {/* ── Score calibration ── */}
      <Panel title="Does the zone score predict anything?" hint="closed signals, sorted by score into ten equal groups">
        <p className={styles.note}>
          The zone engine gives each setup a score. If the score means anything, higher-scored
          setups should win more often. These are the ten score bands, worst to best, with the win
          rate the bot actually got in each — real signals first, then the same view including the
          silent shadow strategies for more samples.
        </p>
        {!cal || cal.real.deciles.length === 0 ? (
          <p className={styles.collecting}>Collecting — not enough scored, closed signals yet.</p>
        ) : (
          <>
            <h3 className={styles.subhead}>Real signals ({cal.real.total} scored & closed)</h3>
            <DataTable
              columns={["Band", "Score range", "Win rate", "Net", "PF", "Signals"]}
              rows={cal.real.deciles.map((d) => decileRow(d))}
              empty="collecting"
            />
            {cal.inclusive.deciles.length > 0 && (
              <>
                <h3 className={styles.subhead}>Including shadow auditions ({cal.inclusive.total} scored & closed)</h3>
                <DataTable
                  columns={["Band", "Score range", "Win rate", "Net", "PF", "Signals"]}
                  rows={cal.inclusive.deciles.map((d) => decileRow(d))}
                  empty="collecting"
                />
              </>
            )}
          </>
        )}
      </Panel>

      {/* ── Condition ledger ── */}
      {ledgerPanel(
        "When does each tier do well?",
        "profit, profit factor and win rate by market condition",
        "The bot splits its closed signals by market regime, volatility (VIX) bucket, weekday and entry hour. Empty or thin buckets are marked as still collecting.",
        ledger?.tierRegime
      )}
      {ledgerPanel("By tier and volatility", "calm vs stressed markets", "Tier × VIX bucket (low or high vs the trailing 20-day median).", ledger?.tierVix)}
      {ledgerPanel("By weekday", "does a day of the week matter yet?", "Every closed signal grouped by its New York weekday.", ledger?.dayOfWeek, WEEKDAY_ORDER)}
      {ledgerPanel("By entry hour", "New York hour of entry", "Every closed signal grouped by the New York hour it entered.", ledger?.entryHour)}

      {/* ── Gate costs ── */}
      <Panel title="What the filters turned away" hint={`skip-reason funnel over the last ${gate?.lookbackDays ?? 30} days of bars`}>
        <p className={styles.note}>
          The engine rejects most potential setups at one gate or another. Re-running the live rules
          over the recent bar archive, this is how many setups each gate turned away — the higher the
          count, the more that filter is shaping what you see. {gate?.note}
        </p>
        {!gate || gate.gates.length === 0 ? (
          <p className={styles.collecting}>Collecting — no archived bars in the window yet.</p>
        ) : (
          <DataTable
            columns={["Gate", "Setups turned away"]}
            rows={gate.gates.map((g) => [<span key="l">{g.label}</span>, <span key="c" className="num">{g.count.toLocaleString()}</span>])}
            empty="collecting"
          />
        )}
      </Panel>

      {/* ── Fill reality ── */}
      <Panel title="Are the fills getting less believable?" hint="share of clean / marginal / doubtful fills per week">
        <p className={styles.note}>
          Every filled signal is graded on how convincingly the bar path supports it: clean, marginal
          or doubtful. If the doubtful share drifts up over the weeks, the market is telling the bot
          its fill assumptions are getting optimistic.
        </p>
        {!fill || fill.weeks.length === 0 ? (
          <p className={styles.collecting}>Collecting — no closed signals yet.</p>
        ) : (
          <DataTable
            columns={["Week", "Clean", "Marginal", "Doubtful", "Doubtful share"]}
            rows={fill.weeks.map((w) => [
              w.week,
              String(w.clean),
              String(w.marginal),
              String(w.doubtful),
              <span key="s" className={w.doubtfulShare >= 25 ? styles.bad : undefined}>{w.doubtfulShare}%</span>,
            ])}
            empty="collecting"
          />
        )}
      </Panel>

      {/* ── Shadow scoreboard ── */}
      <Panel title="Shadow auditions" hint="strategies practising on live data — not signals, never alerted">
        <p className={styles.note}>
          Four extra strategies run silently beside the live tiers. A stream earns promotion interest
          only when it ticks every box: ≥60 closed, PF ≥ 1.2 (costs included), and positive in ≥2
          market regimes. Nothing here is a trade idea.
        </p>
        {!shadow || shadow.streams.length === 0 ? (
          <p className={styles.collecting}>No shadow rows yet — they appear as the engine runs.</p>
        ) : (
          <DataTable
            columns={["Stream", "Closed", "Net", "PF", "Checklist", "Ready?"]}
            rows={shadow.streams.map((s) => [
              <span key="s"><b>{s.strategy}</b> · {s.symbol}</span>,
              String(s.closed),
              <span key="n" className="num">{money(s.net)}</span>,
              fmtPf(s.pf),
              <span key="c" className={styles.checklist}>
                {s.checklist.map((c) => (
                  <span key={c.label} className={c.pass ? styles.good : styles.dim}>
                    {c.pass ? "✓" : "✗"} {c.label}
                  </span>
                ))}
              </span>,
              s.promotable ? <Badge key="y" tone="green">PROMOTABLE</Badge> : <Badge key="a">AUDITIONING</Badge>,
            ])}
            empty="collecting"
          />
        )}
      </Panel>

      <Panel>
        <div className={styles.kpis}>
          <Kpi label="What this page is" value="Observation" sub="pure learning, zero behaviour change" />
          <Kpi label="Money at risk" value="None" sub="paper only, delayed data, never orders" tone="good" />
        </div>
      </Panel>
    </>
  );
}

function decileRow(d: Decile): React.ReactNode[] {
  const range = d.scoreLo === null ? "—" : `${d.scoreLo} – ${d.scoreHi}`;
  if (d.insufficient)
    return [
      `#${d.decile}`,
      range,
      <span key="w" className={styles.collecting}>collecting (n={d.n})</span>,
      "—",
      "—",
      String(d.n),
    ];
  return [
    `#${d.decile}`,
    range,
    d.winRate === null ? "—" : `${d.winRate}%`,
    <span key="n" className="num">{money(d.net)}</span>,
    fmtPf(d.pf),
    String(d.n),
  ];
}
