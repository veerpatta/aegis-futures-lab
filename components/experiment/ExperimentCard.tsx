"use client";

/* The experimental learner on Today, built for a 20-second look:
   what is it doing, what happened to the virtual money, what has changed?

   Three separate state chips (execution, learning, freshness), each with its
   reason; last successful check shown apart from the latest attempt; virtual
   equity with realized and unrealized kept apart; open virtual trades; the
   latest trade and the latest learning result. A missing or stale number is
   shown as "—" or flagged, never as 0. */

import { useState } from "react";
import Link from "next/link";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useNowSec } from "@/components/signals/useSignalFeed";
import { Term } from "@/components/ui/Glossary";
import BottomSheet from "@/components/ui/BottomSheet";
import { executionState, freshnessState, learningState, nextTickSec, type ExpPositionRow } from "@/lib/experiment/view";
import {
  EXP_BADGE_LONG, EXP_LIMITS, EXP_NAME, EXP_WHY, EXECUTION_TONE, EXECUTION_WORDS, FRESHNESS_TONE, FRESHNESS_WORDS, LEARNING_TONE, LEARNING_WORDS,
  changeWords, exitWords, versionName,
} from "@/lib/plain/experiment";
import { marketName } from "@/lib/plain/idea";
import { COMMISSION_RT, pointValue } from "@/lib/experiment/policy";
import { money } from "@/lib/format";
import { clockIn, stampIn, dateShortIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "./experiment.module.css";

const sec = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : null);

export function StateAxes({ nowSec, withLearning = true }: { nowSec: number | null; withLearning?: boolean }) {
  const exp = useExperiment();
  const [open, setOpen] = useState<null | "execution" | "learning" | "freshness">(null);
  if (nowSec === null) return null;
  const execution = executionState(exp.data, nowSec);
  const learning = learningState(exp.data);
  const freshness = freshnessState(exp.data, nowSec, exp.online, exp.failed);
  const axes = [
    { key: "execution" as const, title: "Doing", label: EXECUTION_WORDS[execution.state], tone: EXECUTION_TONE[execution.state], reason: execution.reason },
    ...(withLearning ? [{ key: "learning" as const, title: "Learning", label: LEARNING_WORDS[learning.state], tone: LEARNING_TONE[learning.state], reason: learning.reason }] : []),
    { key: "freshness" as const, title: "Data", label: FRESHNESS_WORDS[freshness.state], tone: FRESHNESS_TONE[freshness.state], reason: freshness.reason },
  ];
  const shown = axes.find((a) => a.key === open) ?? axes[0];
  return (
    <>
      <div className={styles.axes} style={withLearning ? undefined : { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {axes.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`${styles.axis} ${styles[`tone_${a.tone}`]} pressSm`}
            aria-pressed={open === a.key}
            onClick={() => setOpen(open === a.key ? null : a.key)}
            aria-label={`${a.title}: ${a.label}. ${a.reason}`}
          >
            <small>{a.title}</small>
            <b>{a.label}</b>
          </button>
        ))}
      </div>
      <p className={styles.reason} aria-live="polite">
        {shown.reason}
      </p>
    </>
  );
}

function PositionLink({ p, mask }: { p: ExpPositionRow; mask: (s: string) => string }) {
  const { zone } = useZone();
  const open = p.status === "open";
  const unreal = open && p.mark !== null && p.fill_price !== null ? (p.mark - p.fill_price) * (p.side === "LONG" ? 1 : -1) * pointValue(p.symbol) * p.qty - COMMISSION_RT * p.qty : null;
  return (
    <Link href={`/trades/${p.decision_id}`} className={styles.linkRow}>
      <span className={p.side === "LONG" ? styles.buy : styles.sell}>{p.side === "LONG" ? "Long" : "Short"}</span>
      <span className={styles.rowMain}>
        <b>
          {marketName(p.symbol)} · {p.qty} contract{p.qty === 1 ? "" : "s"}
        </b>
        <small>
          {p.status === "pending_fill"
            ? "Order waiting for the next price"
            : p.status === "open"
              ? `Marked ${p.mark_ts ? clockIn(sec(p.mark_ts)!, zone) : "—"}${p.stale ? " · stale, not priced" : " · delayed"}`
              : `${exitWords(p.exit_reason)} · ${p.exit_ts ? dateShortIn(sec(p.exit_ts)!, zone) : ""}`}
        </small>
      </span>
      <span className={`num ${p.status === "closed" ? ((p.net ?? 0) >= 0 ? page.good : page.bad) : unreal === null || p.stale ? page.dim : unreal >= 0 ? page.good : page.bad}`}>
        {p.status === "closed" ? (p.net === null ? "—" : mask(money(p.net))) : unreal === null ? "—" : `${p.stale ? "~" : ""}${mask(money(unreal))}`}
      </span>
      <span className={page.chev} aria-hidden>
        ›
      </span>
    </Link>
  );
}

export default function ExperimentCard() {
  const exp = useExperiment();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const nowSec = useNowSec();
  const [sheet, setSheet] = useState(false);
  const o = exp.data;
  const a = o?.account ?? null;
  const cash = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : mask(v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }));
  const lastOk = sec(a?.last_ok_tick_at);
  const lastTry = sec(o?.last_runs?.tick?.started_at);
  const next = nowSec === null ? null : nextTickSec(nowSec);
  const open = o?.open_positions ?? [];
  const learn = o?.latest_learning ?? null;
  const synthetic = o?.experiment.mode === "synthetic";

  return (
    <section className={`${page.card} ${styles.card}`} aria-label={EXP_NAME} id="learner">
      <div className={styles.banner}>
        <b>VIRTUAL ONLY</b>
        <span>
          <Term k="experimentalLearner">{EXP_NAME}</Term>
        </span>
        <span>· {synthetic ? <Term k="synthetic">synthetic prices</Term> : <Term k="delayed">delayed data</Term>}</span>
        <button type="button" className={`${page.linkButton} ${styles.headLink}`} onClick={() => setSheet(true)}>
          Rules
        </button>
      </div>

      {exp.failed && !o ? (
        <p className={page.note}>The learner couldn&apos;t be checked just now. Pull down to try again.</p>
      ) : !o && !exp.loading ? (
        <p className={page.note}>The learner is not set up yet. It starts with its first scheduled check.</p>
      ) : (
        <>
          <StateAxes nowSec={nowSec} />
          <div className={styles.times}>
            <span>Last check {lastOk ? clockIn(lastOk, zone) : "—"}</span>
            {lastTry && lastTry !== lastOk && <span>Latest attempt {clockIn(lastTry, zone)}</span>}
            {next && <span>Next around {clockIn(next, zone)}</span>}
            {exp.fromSnapshot && exp.loadedAt && <span>Saved copy from {stampIn(exp.loadedAt / 1000, zone)}</span>}
          </div>

          <div className={styles.hero}>
            <div>
              <span className={styles.heroLabel}>
                <Term k="virtualEquity">Virtual equity</Term>
              </span>
              <b className={`${styles.heroValue} num`}>{exp.loading && !a ? "—" : cash(a?.equity)}</b>
              <span className={`${styles.heroSub} num`}>
                {o?.today && o.today.closed > 0
                  ? `Today ${mask(money(o.today.net))} · ${o.today.closed} closed`
                  : a?.day_halted
                    ? "Stopped for today at the loss limit"
                    : "No closed trades today"}
              </span>
            </div>
          </div>
          <div className={styles.split}>
            <div>
              <small>Realized</small>
              <b>{cash(a?.realized)}</b>
            </div>
            <div>
              <small>Open, estimated</small>
              <b>{a ? `${a.unpriced_positions ? "~" : ""}${cash(a.unrealized)}` : "—"}</b>
            </div>
            <div>
              <small>Lifetime</small>
              <b>{o?.lifetime ? `${mask(money(o.lifetime.net))}` : "—"}</b>
            </div>
          </div>
          {a && a.unpriced_positions > 0 && <p className={page.warning}>{a.unpriced_positions} open trade(s) have no fresh price. Their result is an estimate.</p>}

          {open.length > 0 && (
            <div className={page.stack}>
              <b className={styles.subTitle}>
                {open.length} open virtual trade{open.length === 1 ? "" : "s"}
              </b>
              {open.map((p) => (
                <PositionLink key={p.id} p={p} mask={mask} />
              ))}
            </div>
          )}
          {o?.latest_trade && (
            <div className={page.stack}>
              <b className={styles.subTitle}>Latest trade</b>
              <PositionLink p={o.latest_trade} mask={mask} />
            </div>
          )}

          <Link href="/brain" className={styles.linkRow}>
            <span className={styles.rowMain}>
              <b>Latest learning · {learn ? changeWords(learn.kind) : "Collecting results"}</b>
              <small>
                {learn ? `${learn.reason.slice(0, 120)} · ${dateShortIn(sec(learn.created_at)!, zone)}` : `In charge: ${versionName(o?.model?.version_id)}. No change applied.`}
              </small>
            </span>
            <span className={page.chev} aria-hidden>
              ›
            </span>
          </Link>
          <div className={styles.head}>
            <Link href="/trades" className={page.linkButton}>
              All bot trades →
            </Link>
          </div>
        </>
      )}

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Experimental learner rules">
        <div className={styles.sheet}>
          <p>{EXP_WHY}</p>
          <ul>
            {EXP_LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className={page.note}>{EXP_BADGE_LONG}.</p>
        </div>
      </BottomSheet>
    </section>
  );
}
