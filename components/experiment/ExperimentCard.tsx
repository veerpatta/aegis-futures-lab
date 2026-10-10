"use client";

import { useState } from "react";
import Link from "next/link";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useNowSec } from "@/components/signals/useSignalFeed";
import { Term } from "@/components/ui/Glossary";
import BottomSheet from "@/components/ui/BottomSheet";
import { EquityChart, MetricTile, TradeWidget, WidgetIcon, positionVisual } from "@/components/widgets/TradingWidgets";
import { executionState, freshnessState, learningState, nextTickSec } from "@/lib/experiment/view";
import { EXP_BADGE_LONG, EXP_LIMITS, EXP_NAME, EXP_WHY, EXECUTION_TONE, EXECUTION_WORDS, FRESHNESS_TONE, FRESHNESS_WORDS, LEARNING_TONE, LEARNING_WORDS, changeWords, versionName } from "@/lib/plain/experiment";
import { money } from "@/lib/format";
import { clockIn, stampIn, dateShortIn } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import widgets from "@/components/widgets/widgets.module.css";
import styles from "./experiment.module.css";
import ActivityPanel from "./ActivityPanel";

const sec = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : null);

export function StateAxes({ nowSec, withLearning = true }: { nowSec: number | null; withLearning?: boolean }) {
  const exp = useExperiment();
  const [open, setOpen] = useState<null | "execution" | "learning" | "freshness">(null);
  if (nowSec === null) return null;
  const execution = executionState(exp.data, nowSec);
  const learning = learningState(exp.data);
  const freshness = freshnessState(exp.data, nowSec, exp.online, exp.failed);
  const axes = [
    { key: "execution" as const, title: "Doing", label: EXECUTION_WORDS[execution.state], tone: EXECUTION_TONE[execution.state], reason: execution.reason, icon: "activity" as const },
    ...(withLearning ? [{ key: "learning" as const, title: "Learning", label: LEARNING_WORDS[learning.state], tone: LEARNING_TONE[learning.state], reason: learning.reason, icon: "learn" as const }] : []),
    { key: "freshness" as const, title: "Data", label: FRESHNESS_WORDS[freshness.state], tone: FRESHNESS_TONE[freshness.state], reason: freshness.reason, icon: "clock" as const },
  ];
  const shown = axes.find(a => a.key === open);
  const warning = axes.find(a => a.tone === "bad") ?? (freshness.state === "offline" || freshness.state === "stale" ? axes.at(-1) : null);
  return <div className={styles.stateBlock}>
    <div className={styles.axes} style={withLearning ? undefined : { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      {axes.map(a => <button key={a.key} type="button" className={`${styles.axis} ${styles[`tone_${a.tone}`]} pressSm`} aria-pressed={open === a.key} onClick={() => setOpen(open === a.key ? null : a.key)} aria-label={`${a.title}: ${a.label}. ${a.reason}`}>
        <span className={styles.axisTitle}><WidgetIcon name={a.icon} /><small>{a.title}</small></span><b>{a.label}</b>
      </button>)}
    </div>
    {(shown || warning) && <p className={styles.reason} aria-live="polite">{(shown ?? warning)!.reason}</p>}
  </div>;
}

export default function ExperimentCard({ compact = false }: { compact?: boolean }) {
  const exp = useExperiment();
  const { mask, privacy } = usePrivacy();
  const { zone } = useZone();
  const nowSec = useNowSec();
  const [sheet, setSheet] = useState(false);
  const o = exp.data, a = o?.account ?? null;
  const cash = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "—" : mask(money(v, false));
  const lastOk = sec(a?.last_ok_tick_at), lastTry = sec(o?.last_runs?.tick?.started_at);
  const next = nowSec === null ? null : nextTickSec(nowSec);
  const positions = o?.open_positions ?? [], learn = o?.latest_learning ?? null;
  const riskLimit = o?.risk?.totalOpenRisk ?? 200;
  const tone = (v: number | undefined) => v == null || v === 0 ? "blue" as const : v > 0 ? "good" as const : "bad" as const;

  return <section className={styles.dashboard} aria-label={EXP_NAME} id="learner">
    <div className={`${styles.wallet} ${compact ? styles.walletCompact : ""}`}>
      <div className={styles.walletTop}><span className={styles.walletLabel}><WidgetIcon name="wallet" /> One virtual account</span><button type="button" className={styles.rulesButton} onClick={() => setSheet(true)}><WidgetIcon name="shield" /> Rules</button></div>
      <div className={styles.banner}><b>VIRTUAL ONLY</b><span><Term k="experimentalLearner">{EXP_NAME}</Term> · {o?.experiment.mode === "synthetic" ? <Term k="synthetic">synthetic prices</Term> : <Term k="delayed">delayed data</Term>}</span></div>
      {exp.failed && !o ? <p className={page.warning}>The learner couldn&apos;t be checked just now. Pull down to try again.</p> : !o && !exp.loading ? <p className={page.note}>The learner is not set up yet. It starts with its first scheduled check.</p> : <>
        <div className={styles.hero}>
          <div><span className={styles.heroLabel}><Term k="virtualEquity">Virtual equity</Term></span><b className={`${styles.heroValue} num`}>{cash(a?.equity)}</b><span className={styles.heroSub}>{o?.today && o.today.closed > 0 ? `Today ${mask(money(o.today.net))} · ${o.today.closed} closed` : a?.day_halted ? "Stopped for today at the loss limit" : exp.loading && !a ? "Loading your virtual account…" : "No closed trades today"}</span></div>
        </div>
        {!compact && o && <EquityChart data={o} />}
        {!compact && <div className={widgets.metrics}>
          <MetricTile label="Realized" value={cash(a?.realized)} note="Closed trades" icon="check" tone={tone(a?.realized)} />
          <MetricTile label="Open" value={a ? `${a.unpriced_positions ? "~" : ""}${cash(a.unrealized)}` : "—"} note="Estimated result" icon="activity" tone={a?.unpriced_positions ? "warn" : tone(a?.unrealized)} />
          <MetricTile label="Lifetime" value={o?.lifetime ? mask(money(o.lifetime.net)) : "—"} note="All campaigns" icon="wallet" tone={tone(o?.lifetime?.net)} />
        </div>}
        {!compact && a && <div className={styles.riskStrip}><span><WidgetIcon name="shield" /> Open risk <b className="num">{cash(a.open_risk)} / {cash(riskLimit)}</b></span><div aria-hidden style={{ visibility: privacy ? "hidden" : undefined }}><i style={{ width: `${Math.min(100, Math.max(0, a.open_risk / riskLimit * 100))}%` }} /></div></div>}
        {a && a.unpriced_positions > 0 && <p className={page.warning}>{a.unpriced_positions} open trade(s) have no fresh price. Their result is an estimate.</p>}
        <StateAxes nowSec={nowSec} withLearning={!compact} />
        <details className={styles.accountDetails}><summary><WidgetIcon name="clock" />{a?.data_as_of ? `Market data through ${clockIn(Date.parse(a.data_as_of) / 1000, zone)}` : "Account timing"}<span>Details +</span></summary><div className={styles.times}>
          <span>Last check {lastOk ? clockIn(lastOk, zone) : "—"}</span>
          {a?.data_as_of && <span>Market data through {stampIn(Date.parse(a.data_as_of) / 1000, zone)}</span>}
          {lastTry && (lastOk === null || lastTry - lastOk > 60) && <span>Latest attempt {clockIn(lastTry, zone)}</span>}
          {next && <span>Next around {clockIn(next, zone)}</span>}
          {exp.fromSnapshot && exp.loadedAt && <span>Saved copy from {stampIn(exp.loadedAt / 1000, zone)}</span>}
        </div></details>
        {o?.experiment.execution_clock === "delayed_market" && <p className={styles.replayNote}>Fills simulated in delayed market order. Replay results are not fresh proof.</p>}
      </>}
    </div>
    <ActivityPanel />
    {!compact && o && <>
      {positions.length > 0 && <div className={page.stack}><div className={page.sectionHead}><h2>{positions.length} open virtual trade{positions.length === 1 ? "" : "s"}</h2><Link href="/trades">View all →</Link></div><div className={widgets.tradeGrid}>{positions.map((p, i) => <TradeWidget key={p.id} trade={positionVisual(p)} compact index={i} />)}</div></div>}
      {o.latest_trade && <div className={page.stack}><div className={page.sectionHead}><h2>Latest trade</h2><Link href="/trades">History →</Link></div><TradeWidget trade={positionVisual(o.latest_trade)} compact /></div>}
      <Link href="/brain" className={styles.learningLink}><span className={styles.learningIcon}><WidgetIcon name="learn" /></span><span className={styles.rowMain}><b>Latest learning · {learn ? changeWords(learn.kind) : "Collecting results"}</b><small>{learn ? `${learn.reason.slice(0, 120)} · ${dateShortIn(sec(learn.created_at)!, zone)}` : `In charge: ${versionName(o.model?.version_id)}. No change applied.`}</small></span><span aria-hidden>›</span></Link>
      <Link href="/trades" className={styles.tradeButton}>All bot trades <span aria-hidden>↗</span></Link>
    </>}
    <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Experimental learner rules"><div className={styles.sheet}><p>{EXP_WHY}</p><ul>{EXP_LIMITS.map(l => <li key={l}>{l}</li>)}</ul><p className={page.note}>{EXP_BADGE_LONG}.</p></div></BottomSheet>
  </section>;
}
