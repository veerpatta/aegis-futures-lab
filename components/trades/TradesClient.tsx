"use client";

/* Trades — the experimental learner's own ledger: every idea it decided on,
   taken or skipped, newest first, 40 at a time. Each row opens the evidence
   behind it (/trades/[id]). Only the learner's virtual trades live here: the
   personal journal (/replay) and the trade-ideas record stay separate. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getNeon } from "@/lib/neon/client";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { Term } from "@/components/ui/Glossary";
import { StateAxes } from "@/components/experiment/ExperimentCard";
import { useNowSec } from "@/components/signals/useSignalFeed";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { EXP_NAME, PROVENANCE, cancelWords, exitWords, skipWords } from "@/lib/plain/experiment";
import { marketName } from "@/lib/plain/idea";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "@/components/experiment/experiment.module.css";

type Filter = "all" | "taken" | "skipped" | "open" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "taken", label: "Taken" },
  { key: "skipped", label: "Skipped" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];
const PAGE = 40;
const COLUMNS =
  "id,decision_key,symbol,side,decided_at,provenance,action,reason,qty,model_version_id,position_status,cancel_reason,exit_reason,exit_ts,net,stale,mode,campaign";

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
  const experimentId = exp.data?.experiment.id ?? null;

  const load = useCallback(
    async (offset: number) => {
      if (!experimentId) return;
      setLoading(true);
      try {
        let q = getNeon().from("experiment_trades").select(COLUMNS).eq("experiment_id", experimentId);
        if (filter === "taken") q = q.eq("action", "take");
        if (filter === "skipped") q = q.eq("action", "skip");
        if (filter === "open") q = q.in("position_status", ["open", "pending_fill"]);
        if (filter === "closed") q = q.eq("position_status", "closed");
        const res = await q.order("decided_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE - 1);
        if (res.error) throw new Error(res.error.message);
        const next = (res.data ?? []) as unknown as ExpTradeRow[];
        setRows((prev) => (offset === 0 ? next : [...prev, ...next]));
        setMore(next.length === PAGE);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [experimentId, filter],
  );

  useEffect(() => {
    setRows([]);
    void load(0);
  }, [load]);

  const closed = exp.data?.campaign_totals;
  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Trades</h1>
        <p className={page.paperLine}>VIRTUAL ONLY · {EXP_NAME} · {exp.data?.experiment.mode === "synthetic" ? "Synthetic prices" : "Delayed data"}</p>
      </header>

      <section className={`${page.card} ${styles.card}`} aria-label="Learner summary">
        <StateAxes nowSec={nowSec} withLearning={false} />
        <div className={styles.split}>
          <div>
            <small>
              <Term k="virtualEquity">Virtual equity</Term>
            </small>
            <b>{exp.data?.account ? mask(money(exp.data.account.equity, false)) : "—"}</b>
          </div>
          <div>
            <small>Closed this campaign</small>
            <b>{closed ? `${closed.closed} · ${mask(money(closed.net))}` : "—"}</b>
          </div>
          <div>
            <small>Costs paid</small>
            <b>{closed ? mask(money(closed.fees, false)) : "—"}</b>
          </div>
        </div>
        <p className={page.note}>
          Every idea the learner saw, taken or skipped, with the reason. Results are after modeled costs on delayed prices. Your own journal stays
          separate.
        </p>
      </section>

      <div className={styles.filters} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

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
        <p className={page.loading}>Loading trades…</p>
      ) : rows.length === 0 ? (
        <p className={page.empty}>No {filter === "all" ? "" : `${filter} `}decisions yet. Quiet days are normal — it waits for a setup.</p>
      ) : (
        <section className={page.stack} aria-label="Bot trades">
          {rows.map((r) => (
            <Link key={r.id} href={`/trades/${r.id}`} className={styles.linkRow}>
              <span className={r.action === "take" ? (r.side === "LONG" ? styles.buy : styles.sell) : `${page.chip} ${page.chip_dim}`}>
                {r.action === "take" ? (r.side === "LONG" ? "Long" : "Short") : "Skip"}
              </span>
              <span className={styles.rowMain}>
                <b>
                  {marketName(r.symbol)}
                  {r.action === "take" ? ` · ${r.qty} contract${r.qty === 1 ? "" : "s"}` : ""}
                </b>
                <small>
                  {outcomeLine(r)} · {stampIn(Date.parse(r.decided_at) / 1000, zone)}
                  {r.provenance !== "prospective" ? ` · ${PROVENANCE[r.provenance]?.label ?? r.provenance}` : ""}
                </small>
              </span>
              <span className={`num ${r.net === null ? page.dim : r.net >= 0 ? page.good : page.bad}`}>
                {r.position_status === "closed" && r.net !== null ? mask(money(r.net)) : "—"}
              </span>
              <span className={page.chev} aria-hidden>
                ›
              </span>
            </Link>
          ))}
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
