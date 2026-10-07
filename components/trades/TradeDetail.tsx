"use client";

/* One bot trade, with the evidence behind it. "What happened" (the simulated
   fill, the exit trigger, gross, fees and net) is kept apart from "why" (the
   rule values frozen when the decision was made). No story is invented after
   a loss: a single result is not a pattern, and the page says so. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getNeon } from "@/lib/neon/client";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { Term } from "@/components/ui/Glossary";
import ShowNumbers from "@/components/ui/ShowNumbers";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { PROVENANCE, cancelWords, exitWords, skipWords, versionName } from "@/lib/plain/experiment";
import { marketName } from "@/lib/plain/idea";
import { pointValue } from "@/lib/experiment/policy";
import { money } from "@/lib/format";
import { stampIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "@/components/experiment/experiment.module.css";
import { outcomeLine } from "./TradesClient";

const px = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function TradeDetail({ id }: { id: string }) {
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const [row, setRow] = useState<ExpTradeRow | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "failed" | "ok">("loading");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const n = Number(id);
        if (!Number.isInteger(n)) return setState("missing");
        const res = await getNeon().from("experiment_trades").select("*").eq("id", n).limit(1);
        if (res.error) throw new Error(res.error.message);
        if (!live) return;
        const r = (res.data?.[0] ?? null) as ExpTradeRow | null;
        setRow(r);
        setState(r ? "ok" : "missing");
      } catch {
        if (live) setState("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const when = (iso: string | null) => (iso ? stampIn(Date.parse(iso) / 1000, zone) : "—");
  if (state !== "ok" || !row)
    return (
      <div className={page.page}>
        <header className={page.head}>
          <h1 className="pageTitle">Trade</h1>
          <Link href="/trades" className={page.linkButton}>
            ← All bot trades
          </Link>
        </header>
        <p className={state === "failed" ? page.warning : page.loading}>
          {state === "loading" ? "Loading…" : state === "missing" ? "No bot trade with this number." : "This trade could not load. Pull down to try again."}
        </p>
      </div>
    );

  const taken = row.action === "take";
  const closed = row.position_status === "closed";
  const slipDollars = ((row.entry_slip ?? 0) + (row.exit_slip ?? 0)) * pointValue(row.symbol) * (row.qty || 1);
  const idea = row.idea;
  const prov = PROVENANCE[row.provenance];
  const shadowNet = row.shadow_status === "closed" && row.shadow_net_per_contract !== null && row.shadow_qty ? row.shadow_net_per_contract * row.shadow_qty : null;

  return (
    <div className={page.page}>
      <header className={page.head}>
        <Link href="/trades" className={page.linkButton}>
          ← All bot trades
        </Link>
        <h1 className="pageTitle">
          {taken ? (closed ? ((row.net ?? 0) >= 0 ? "Closed gain" : "Closed loss") : outcomeLine(row)) : "Skipped idea"}
        </h1>
        <p className={page.paperLine}>
          VIRTUAL ONLY · Experimental learner · {row.mode === "synthetic" ? "Synthetic prices" : "Delayed data"}
        </p>
      </header>

      <section className={`${page.card} ${styles.card}`} aria-label="Result">
        <div className={styles.hero}>
          <div>
            <span className={styles.heroLabel}>
              {marketName(row.symbol)} · {row.side === "LONG" ? "Long" : "Short"}
              {taken ? ` · ${row.qty} contract${row.qty === 1 ? "" : "s"}` : ""} · {versionName(row.model_version_id)}
            </span>
            <b className={`${styles.heroValue} num ${closed ? ((row.net ?? 0) >= 0 ? page.good : page.bad) : ""}`}>
              {closed && row.net !== null ? `${mask(money(row.net))}` : taken ? "—" : "Not taken"}
            </b>
            <span className={styles.heroSub}>{closed ? "after costs" : outcomeLine(row)}</span>
          </div>
        </div>
        <p className={page.note}>
          {prov?.label}: {prov?.note}
        </p>
      </section>

      <section className={`${page.card} ${styles.card}`} aria-label="What happened">
        <h2 className={page.cardTitle}>What happened</h2>
        {taken ? (
          <dl className={styles.facts}>
            <dt>Decided</dt>
            <dd>{when(row.decided_at)}</dd>
            <dt>Filled</dt>
            <dd>{row.fill_ts ? `${px(row.fill_price)} at ${when(row.fill_ts)}` : row.position_status === "cancelled" ? cancelWords(row.cancel_reason) : "Waiting for the next price"}</dd>
            <dt>Exit</dt>
            <dd>{row.exit_ts && closed ? `${exitWords(row.exit_reason)} · ${px(row.exit_price)} at ${when(row.exit_ts)}` : row.position_status === "open" ? "Open now" : "—"}</dd>
            {closed && (
              <>
                <dt>Price move</dt>
                <dd>{row.gross === null ? "—" : mask(money(row.gross))}</dd>
                <dt>
                  <Term k="costs">Commission</Term>
                </dt>
                <dd>{row.fees === null ? "—" : mask(money(-row.fees))}</dd>
                <dt>
                  <Term k="slippage">Slippage</Term>
                </dt>
                <dd>{mask(money(-slipDollars))} (already in the prices)</dd>
                <dt>Net</dt>
                <dd>{row.net === null ? "—" : mask(money(row.net))}</dd>
              </>
            )}
            {row.position_status === "open" && (
              <>
                <dt>Last mark</dt>
                <dd>
                  {px(row.mark)} at {when(row.mark_ts)}
                  {row.stale ? " · stale, no fresh price" : " · delayed"}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className={styles.reason}>{skipWords(row.reason)}.</p>
        )}
        {row.ambiguous && (
          <p className={page.warning}>
            One price bar touched both the stop and the target. One bar can&apos;t say which came first, so the stop was assumed.
          </p>
        )}
      </section>

      <section className={`${page.card} ${styles.card}`} aria-label="Why it entered">
        <h2 className={page.cardTitle}>{taken ? "Why it entered" : "The idea it saw"}</h2>
        <dl className={styles.facts}>
          <dt>Method</dt>
          <dd>{idea?.strategy ?? "—"}</dd>
          <dt>Idea prices</dt>
          <dd>
            entry {px(idea?.entry)} · stop {px(idea?.stop)} · target {idea?.target == null ? "none" : px(idea.target)}
          </dd>
          <dt>Price when decided</dt>
          <dd>{px(row.ref_price)}</dd>
          <dt>Rule</dt>
          <dd>
            {row.threshold === null
              ? "Take every eligible idea (frozen control)."
              : `Take when the model's odds ≥ ${(row.threshold * 100).toFixed(0)}%. It gave ${row.p_win === null ? "—" : `${(row.p_win * 100).toFixed(0)}%`}.`}
          </dd>
          {taken && (
            <>
              <dt>At risk</dt>
              <dd>{row.risk === null ? (row.est_risk === null ? "—" : mask(money(row.est_risk, false))) : mask(money(row.risk, false))} incl. costs</dd>
            </>
          )}
        </dl>
        <ShowNumbers label="Values saved at decision time">
          <dl className={styles.facts}>
            {Object.entries(row.features ?? {}).map(([k, v]) => (
              <span key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v === null ? "—" : typeof v === "number" ? v.toFixed(3) : String(v)}</dd>
              </span>
            ))}
            <dt>Features</dt>
            <dd>{row.feature_version}</dd>
            <dt>Snapshot</dt>
            <dd>{row.snapshot_hash.slice(0, 16)}…</dd>
            <dt>Model</dt>
            <dd>{row.model_version_id}</dd>
            <dt>Decision key</dt>
            <dd>{row.decision_key}</dd>
          </dl>
        </ShowNumbers>
      </section>

      <section className={`${page.card} ${styles.card}`} aria-label="What was learned">
        <h2 className={page.cardTitle}>What was learned</h2>
        <p className={styles.reason}>
          One result is not a pattern, and a loss is not automatically a mistake.{" "}
          {row.shadow_status === "closed"
            ? `Its one-trade test result (${shadowNet === null ? "—" : mask(money(shadowNet))}) is in the learning record and counts in the next dataset${
                row.provenance === "prospective" ? "" : ", kept apart as non-fresh evidence"
              }.`
            : row.shadow_status === "void"
              ? "No fill was possible, so it teaches nothing and is left out of learning."
              : "It enters the learning record once its test result is final."}{" "}
          Skipped ideas are followed the same way, so the learner cannot learn only from its own winners.
        </p>
        <Link href="/brain" className={page.linkButton}>
          See what the learner has learned →
        </Link>
      </section>
    </div>
  );
}
