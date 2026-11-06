"use client";

/* Trades — every decision of the current virtual campaign, taken or skipped,
   newest first, as one clean list (plan:
   docs/superpowers/plans/2026-11-07-free-ai-and-ui-revamp.md).

   A one-card summary on top, then filters, then one row per decision; each
   row opens the full story on /trades/[id]. The research view of how ideas
   reach the bot (the day's check-by-check funnel) is folded at the bottom and
   loads only when opened. Only the learner's virtual trades live here: the
   personal journal (/replay) and the method ideas (/signals) stay separate. */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import ActivityPanel from "@/components/experiment/ActivityPanel";
import Fold from "@/components/ui/Fold";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import { TradeRow } from "./TradeRow";
import { useTrades, type TradeFilter } from "./useTrades";
import page from "@/components/ui/page.module.css";
import s from "./trades.module.css";

export { outcomeLine } from "./TradeRow";

const FILTERS: { key: TradeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "taken", label: "Taken" },
  { key: "skipped", label: "Skipped" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "earlier", label: "Past campaigns" },
];
const PAGE = 40;

function ViewLink({ select }: { select: (view: TradeFilter) => void }) {
  const params = useSearchParams();
  const view = params.get("view");
  useEffect(() => { if (view === "open") select("open"); }, [view, select]);
  return null;
}

export default function TradesClient() {
  const exp = useExperiment();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const [filter, setFilter] = useState<TradeFilter>("all");
  const trades = useTrades(filter, PAGE);
  const o = exp.data;
  const totals = o?.campaign_totals;
  const open = o ? o.open_positions.filter((p) => p.status === "open").length : null;
  const select = (next: TradeFilter) => { if (next !== filter) { trades.reset(); setFilter(next); } };
  const tone = (v: number | null | undefined) => (v == null || v === 0 ? page.dim : v > 0 ? page.good : page.bad);

  return (
    <div className={page.page}>
      <Suspense fallback={null}><ViewLink select={select} /></Suspense>
      <header className={page.head}>
        <h1 className="pageTitle">Trades</h1>
        <p className={page.paperLine}>Virtual money only · Prices delayed 10–15 minutes · After modeled costs</p>
      </header>

      <section className={`${page.card} ${s.summary}`} aria-label="Trade summary">
        <div className={s.summaryTop}>
          <span>Virtual balance</span>
          <b className="num">{o?.account ? mask(money(o.account.equity, false)) : "—"}</b>
        </div>
        <div className={s.summaryStats}>
          <span><b className="num">{totals ? totals.closed : "—"}</b> closed</span>
          <span><b className="num">{totals ? totals.wins : "—"}</b> won</span>
          <span><b className="num">{totals ? totals.closed - totals.wins : "—"}</b> lost</span>
          <span><b className="num">{open ?? "—"}</b> open</span>
          <span>Result <b className={`num ${tone(totals?.net)}`}>{totals ? mask(money(totals.net)) : "—"}</b></span>
        </div>
        <p className={page.note}>
          Campaign {o?.experiment.campaign ?? "—"}
          {totals ? ` · costs paid ${mask(money(totals.fees, false))}` : ""}
          {o?.account?.data_as_of ? ` · prices through ${stampIn(Date.parse(o.account.data_as_of) / 1000, zone)}` : ""}
        </p>
      </section>

      <div className={page.chips} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={page.chipButton} aria-pressed={filter === f.key} onClick={() => select(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {filter === "earlier" && <p className={page.note}>Past campaigns stay on record. They do not add money to the current account.</p>}

      {trades.failed && (
        <p className={page.warning}>
          Trades could not load.{" "}
          <button type="button" onClick={() => void trades.load(0)}>Try again</button>
        </p>
      )}
      {!trades.ready && !exp.loading ? (
        <p className={page.empty}>The virtual account is not set up yet, so there are no bot trades to show.</p>
      ) : trades.rows.length === 0 && trades.loading ? (
        <p className={page.loading} role="status">Loading trades…</p>
      ) : trades.rows.length === 0 ? (
        <p className={page.empty}>No {filter === "all" ? "" : `${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} `}trades yet. Quiet days are normal: the bot waits for a setup.</p>
      ) : (
        <section className={page.stack} aria-label="Bot trades" aria-busy={trades.loading}>
          <div className={page.list}>{trades.rows.map((r) => <TradeRow key={`${filter}:${r.id}`} row={r} />)}</div>
          {trades.more && (
            <button type="button" className={page.linkButton} disabled={trades.loading} onClick={() => void trades.load(trades.rows.length)}>
              {trades.loading ? "Loading…" : "Show older"}
            </button>
          )}
        </section>
      )}

      <Fold id="activity" summary="Under the hood · how today's ideas reached the bot">
        <ActivityPanel />
      </Fold>
    </div>
  );
}
