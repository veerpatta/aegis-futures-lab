"use client";

/* Trades — the experimental learner's own ledger: every idea it decided on,
   taken or skipped, newest first, 40 at a time. Each row opens the evidence
   behind it (/trades/[id]). Only the learner's virtual trades live here: the
   personal journal (/replay) and the trade-ideas record stay separate. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { StateAxes } from "@/components/experiment/ExperimentCard";
import { EquityChart, MetricTile, TradeWidget, WidgetIcon, ledgerVisual } from "@/components/widgets/TradingWidgets";
import { useNowSec } from "@/components/signals/useSignalFeed";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { cancelWords, exitWords, skipWords } from "@/lib/plain/experiment";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "@/components/experiment/experiment.module.css";
import widgets from "@/components/widgets/widgets.module.css";
import tradeStyles from "./trades.module.css";

type Filter = "all" | "taken" | "skipped" | "open" | "closed" | "earlier";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "taken", label: "Taken" },
  { key: "skipped", label: "Skipped" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "earlier", label: "Earlier attempts" },
];
const PAGE = 40;
const COLUMNS =
  "id,decision_key,symbol,side,decided_at,provenance,action,reason,qty,model_version_id,position_status,cancel_reason,exit_reason,exit_ts,net,stale,mode,campaign,execution_clock,observed_at,recorded_at,idea,fill_price,fill_ts,mark,mark_ts,exit_price";

export function outcomeLine(r: Pick<ExpTradeRow, "action" | "reason" | "position_status" | "cancel_reason" | "exit_reason">): string {
  if (r.action !== "take") return skipWords(r.reason);
  if (r.position_status === "pending_fill") return "Order waiting for the next price";
  if (r.position_status === "open") return "Open now";
  if (r.position_status === "cancelled") return cancelWords(r.cancel_reason);
  return exitWords(r.exit_reason);
}

export default function TradesClient() {
  const exp = useExperiment();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const nowSec = useNowSec();
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<ExpTradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const request = useRef(0);
  const experimentId = exp.data?.experiment.id ?? null;

  const load = useCallback(
    async (offset: number) => {
      if (!experimentId) return;
      const current = ++request.current;
      setLoading(true);
      try {
        let q = getNeon().from("experiment_trades").select(COLUMNS);
        q = filter === "earlier" ? q.eq("lineage", "learner").neq("experiment_id", experimentId) : q.eq("experiment_id", experimentId);
        if (filter === "taken") q = q.eq("action", "take");
        if (filter === "skipped") q = q.eq("action", "skip");
        if (filter === "open") q = q.in("position_status", ["open", "pending_fill"]);
        if (filter === "closed") q = q.eq("position_status", "closed");
        const res = await q.order("decided_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE - 1);
        if (res.error) throw new Error(res.error.message);
        if (current !== request.current) return;
        const next = (res.data ?? []) as unknown as ExpTradeRow[];
        setRows((prev) => (offset === 0 ? next : [...prev, ...next]));
        setMore(next.length === PAGE);
        setFailed(false);
      } catch {
        if (current === request.current) setFailed(true);
      } finally {
        if (current === request.current) setLoading(false);
      }
    },
    [experimentId, filter],
  );

  useEffect(() => {
    void load(0);
    return () => { request.current++; };
  }, [load, exp.loadedAt]);

  const closed = exp.data?.campaign_totals;
  const open = exp.data?.open_positions.filter(p => p.status === "open").length;
  const select = (next: Filter) => { if (next !== filter) { request.current++; setRows([]); setLoading(true); setFilter(next); } };
  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Trades</h1>
        <p className={page.lede}>Your virtual trading desk</p>
        <p className={page.paperLine}>VIRTUAL ONLY · {exp.data?.experiment.mode === "synthetic" ? "Synthetic prices" : "Delayed data"}</p>
      </header>

      <section className={tradeStyles.summary} aria-label="Learner summary">
        <div className={tradeStyles.summaryTop}><span><WidgetIcon name="wallet" /> One virtual account</span><span className={tradeStyles.mode}>Practice</span></div>
        <div className={tradeStyles.balanceRow}><div className={tradeStyles.balance}><span>Virtual equity</span><b className="num">{exp.data?.account ? mask(money(exp.data.account.equity, false)) : "—"}</b><small>Closed <strong className={closed && closed.net < 0 ? page.bad : closed && closed.net > 0 ? page.good : page.dim}>{closed ? mask(money(closed.net)) : "—"}</strong> · after costs</small></div>
        {exp.data && <EquityChart data={exp.data} compact />}</div>
        <div className={widgets.metrics}>
          <MetricTile label="Open" value={open == null ? "—" : String(open)} icon="activity" onClick={() => select("open")} active={filter === "open"} />
          <MetricTile label="Closed" value={closed ? String(closed.closed) : "—"} icon="check" onClick={() => select("closed")} active={filter === "closed"} />
          <MetricTile label="Costs paid" value={closed ? mask(money(closed.fees, false)) : "—"} icon="wallet" tone="warn" />
        </div>
        <StateAxes nowSec={nowSec} withLearning={false} />
        {exp.data?.account?.data_as_of && <p className={tradeStyles.dataStamp}><WidgetIcon name="clock" /> Market data through {stampIn(Date.parse(exp.data.account.data_as_of) / 1000, zone)}</p>}
      </section>

      <div className={`${page.sectionHead} ${tradeStyles.activityTitle}`}><h2>Trade activity</h2><span className={page.note}>Tap a card to explore</span></div>
      <div className={styles.filters} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => select(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <p className={page.note}>{filter === "earlier" ? "Earlier attempts stay on record. They do not add money to the current account." : "After modeled costs · Open results are estimates."}</p>

      {failed && (
        <p className={page.warning}>
          Trades could not load.{" "}
          <button type="button" onClick={() => void load(0)}>
            Try again
          </button>
        </p>
      )}
      {!experimentId && !exp.loading ? (
        <p className={page.empty}>The learner is not set up yet, so there are no bot trades to show.</p>
      ) : rows.length === 0 && loading ? (
        <div className={tradeStyles.loading} role="status"><WidgetIcon name="activity" /><p className={page.loading}>Loading trades…</p></div>
      ) : rows.length === 0 ? (
        <p className={page.empty}>No {filter === "all" ? "" : `${filter} `}decisions yet. Quiet days are normal — it waits for a setup.</p>
      ) : (
        <section className={widgets.tradeGrid} aria-label="Bot trades" aria-busy={loading}>
          {rows.map((r, i) => <TradeWidget key={`${filter}:${r.id}`} trade={ledgerVisual(r, outcomeLine(r))} index={i} />)}
          {more && (
            <button type="button" className={`${page.linkButton} ${styles.more}`} disabled={loading} onClick={() => void load(rows.length)}>
              {loading ? "Loading…" : "Show older"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
