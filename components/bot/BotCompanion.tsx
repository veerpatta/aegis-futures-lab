"use client";

import { useEffect, useRef, useState } from "react";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { useNowSec } from "@/components/signals/useSignalFeed";
import { ProgressRing, WidgetIcon } from "@/components/widgets/TradingWidgets";
import { botActivity, checkedLearningExamples, learningMilestone, nextLearningCheck } from "@/lib/plain/companion";
import { nextTickSec, type ExpLearning } from "@/lib/experiment/view";
import type { LearningAudit } from "@/lib/experiment/learning-audit";
import { PREREG } from "@/lib/experiment/prereg";
import { stampIn } from "@/lib/time/zones";
import s from "./companion.module.css";

export default function BotCompanion({ data, failed }: { data: ExpLearning | null; failed: boolean }) {
  const exp = useExperiment();
  const { zone } = useZone();
  const now = useNowSec();
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    if (stage.current) observer.observe(stage.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const activity = botActivity(exp.data, now, exp.online, exp.failed || failed);
  const g = { ...PREREG.gates, ...data?.prereg?.gates };
  const checked = checkedLearningExamples(data, exp.data);
  const examples = checked?.count;
  const milestone = learningMilestone(data, g.minTrainRows, examples ?? null);
  const versions = data?.versions.filter(v => v.kind === "logit" && v.trained_at) ?? [];
  const improvements = data?.changes.filter(c => c.kind === "adopted").length;
  const runs = Object.entries(exp.data?.last_runs ?? {}).filter(([, r]) => !!r).sort((a, b) => Date.parse(b[1]!.started_at) - Date.parse(a[1]!.started_at));
  const audited = runs.find(([key, run]) => key !== "tick" && !!run?.counts?.learning);
  const audit = audited?.[1]?.counts.learning as LearningAudit | undefined;
  const when = (iso: string | null | undefined) => iso ? stampIn(Date.parse(iso) / 1000, zone) : "Not recorded yet";
  const nextTick = now ? nextTickSec(now) : null;
  const moving = activity.moving && visible && !paused;
  const jobNames: Record<string, string> = { tick: "Market check", learn: "Learning notebook", review: "Model review" };
  const jobStatus: Record<string, string> = { ok: "Finished", running: "Started", error: "Needs attention", skipped: "Deferred", partial: "Partly finished" };

  return <div className={s.stack}>
    <section className={`${s.hero} ${s[activity.mood]}`} aria-label="Bot activity">
      <div className={s.heroTop}><span><i /> Aegis bot</span><span className={s.badge}>Virtual only</span></div>
      <div ref={stage} className={s.stage} data-animated={moving} data-mood={activity.mood}>
        <div className={s.orbit} aria-hidden><i /><i /><i /></div>
        <svg className={s.robot} viewBox="0 0 240 200" fill="none" aria-hidden="true">
          <defs><linearGradient id="bot-shell" x1="45" y1="28" x2="184" y2="164" gradientUnits="userSpaceOnUse"><stop stopColor="#204a50" /><stop offset="1" stopColor="#0d1c2e" /></linearGradient></defs>
          <ellipse className={s.shadow} cx="120" cy="183" rx="54" ry="7" fill="currentColor" opacity=".09" />
          <g className={s.botBody}>
            <path d="M120 38V22" stroke="currentColor" strokeWidth="4" /><circle className={s.antenna} cx="120" cy="17" r="6" fill="currentColor" />
            <rect x="49" y="57" width="15" height="45" rx="7" fill="#193544" stroke="currentColor" strokeOpacity=".35" /><rect x="176" y="57" width="15" height="45" rx="7" fill="#193544" stroke="currentColor" strokeOpacity=".35" />
            <rect x="60" y="37" width="120" height="100" rx="32" fill="url(#bot-shell)" stroke="currentColor" strokeOpacity=".55" />
            <rect x="73" y="54" width="94" height="56" rx="20" fill="#07121d" stroke="currentColor" strokeOpacity=".15" />
            <g className={s.eyes}><rect x="91" y="73" width="13" height="18" rx="6" fill="currentColor" /><rect x="136" y="73" width="13" height="18" rx="6" fill="currentColor" /></g>
            <path d="M109 120h22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
            <rect x="85" y="143" width="70" height="25" rx="12" fill="url(#bot-shell)" stroke="currentColor" strokeOpacity=".3" />
            <path className={s.pulse} d="M103 155h7l4-5 6 10 5-5h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
        <span className={s.statePill}>{activity.mood === "watching" ? "Between checks" : activity.mood === "organising" || activity.mood === "reviewing" ? "Job reported running" : activity.mood === "managing" ? "Virtual positions" : "Recorded status"}</span>
        <button className={s.motion} type="button" aria-pressed={paused} aria-label={paused ? "Resume bot animation" : "Pause bot animation"} onClick={() => setPaused(v => !v)}>{paused ? "▶" : "Ⅱ"}</button>
      </div>
      <div className={s.activityCopy} aria-live="polite"><h2>{activity.title}</h2><p>{activity.detail}</p></div>
      <div className={s.checkTime}><WidgetIcon name="clock" /><span>Last successful check <b>{when(exp.data?.account?.last_ok_tick_at)}</b></span></div>
    </section>

    <section className={s.card} aria-label="Learning progress">
      <div className={s.sectionTitle}><h2>My learning notebook</h2><span className={s.badge}>Evidence, not a score</span></div>
      <div className={s.progressHero}>
        {examples === undefined ? <div className={s.placeholder}>—</div> : <ProgressRing value={Math.min(examples, g.minTrainRows)} of={g.minTrainRows} label="usable examples needed to start training" />}
        <div><b>{examples === undefined ? "Awaiting an example check" : `${examples} usable examples`}</b><p>Taken and skipped ideas with a finished, usable result.</p>{checked && <small className={s.honesty}>Checked {when(checked.at)}</small>}</div>
      </div>
      <div className={s.milestone}><WidgetIcon name="learn" /><div><b>{milestone.title}</b><p>{milestone.detail}</p></div></div>
      <div className={s.stats}>
        <div><b>{data ? versions.length : "—"}</b><span>Versions trained</span></div>
        <div><b>{data ? improvements : "—"}</b><span>Changes adopted</span></div>
        <div><b>{data?.progress?.closed_prospective ?? "—"}</b><span>Fresh results</span></div>
      </div>
      <p className={s.honesty}>Delayed replay can help train a version. It cannot supply the fresh proof needed to adopt it.</p>
      <details className={s.details}><summary>The path to a better bot <span>+</span></summary>
        <ol className={s.roadmap}><li><b>Collect examples</b><span>At least {g.minTrainRows} before training starts.</span></li><li><b>Test on later days</b><span>At least {g.minOos} results the version did not train on, with costs and random-entry comparisons.</span></li><li><b>Earn fresh proof</b><span>Each candidate needs {g.freshDecisions} fresh ideas over {g.freshSessions} trading days and two passing reviews at least {g.reviewGapDays} days apart.</span></li><li><b>Keep or reject</b><span>Only a tested improvement takes over. The previous version is kept for rollback.</span></li></ol>
      </details>
    </section>

    <section className={s.card} aria-label="Automatic learning schedule">
      <div className={s.sectionTitle}><h2>Working on its own</h2><WidgetIcon name="clock" /></div>
      <div className={s.schedule}><div><span>Market check</span><b>{nextTick ? stampIn(nextTick, zone) : "Checking schedule"}</b></div><div><span>Next notebook update</span><b>{now ? stampIn(nextLearningCheck(now, "learn"), zone) : "—"}</b></div><div><span>Next model review</span><b>{now ? stampIn(nextLearningCheck(now, "review"), zone) : "—"}</b></div></div>
      <p className={s.honesty}>Expected times. Jobs may wait for data or free usage limits. You can close the app; the scheduled jobs continue.</p>
    </section>

    <section className={s.card} aria-label="Recent bot activity">
      <div className={s.sectionTitle}><h2>Recent activity</h2><WidgetIcon name="activity" /></div>
      {!runs.length ? <p className={s.honesty}>The first recorded check will appear here.</p> : <ul className={s.log}>{runs.map(([key, run]) => <li key={key}><i className={run?.status === "error" ? s.errorDot : ""} /><div><b>{jobNames[key] ?? key}</b><span>{jobStatus[run!.status] ?? "Recorded"} · {when(run?.finished_at ?? run?.started_at)}</span>{key === "learn" && typeof run?.counts.rows === "number" && <small>{run.counts.rows} usable examples checked{run.counts.dataset === "unchanged" ? " · saved dataset reused" : ""}.</small>}{key === "review" && run?.counts.fitCache != null && <small>{Number((run.counts.fitCache as { reused?: number }).reused ?? 0)} identical model fits reused in this review.</small>}</div></li>)}</ul>}
      <details className={s.details}><summary>Example quality at the last check <span>+</span></summary>
        {!audit ? <p className={s.honesty}>The next notebook update or model review will record this breakdown.</p> : <><p className={s.honesty}>Checked {when(audited?.[1]?.finished_at)}. These counts describe that check.</p><dl className={s.quality}><dt>Usable examples</dt><dd>{audit.usable} of {audit.checked}</dd><dt>From taken / skipped ideas</dt><dd>{audit.fromTaken} / {audit.fromSkipped}</dd><dt>Replay / fresh / synthetic / late</dt><dd>{audit.replay} / {audit.prospective} / {audit.synthetic} / {audit.late}</dd><dt>Still waiting / after cutoff</dt><dd>{audit.awaiting} / {audit.afterCutoff}</dd><dt>No fill / too risky</dt><dd>{audit.noFill} / {audit.tooRisky}</dd><dt>Missing details / duplicates</dt><dd>{audit.missingFeatures} / {audit.duplicate}</dd><dt>Ambiguous exits, stop first</dt><dd>{audit.ambiguous}</dd></dl></>}
      </details>
    </section>

    <details className={`${s.card} ${s.details}`}><summary>Built to avoid extra costs <span>+</span></summary><p className={s.honesty}>Small models use the existing stored outcomes. No paid AI calls or new data purchases. Identical training inputs share one fit within a review; the cache is discarded after the job.</p><p className={s.honesty}>{exp.data?.quota_level === "essential" ? "Optional learning is paused near the usage limit." : exp.data?.quota_level === "conserve" ? "New candidate searches are paused to conserve free usage." : exp.data?.quota_level === "reduce" ? "Optional work is reduced to conserve free usage." : "The bot checks its usage guard before running optional work. This is a usage guard, not a provider billing meter."}</p></details>
  </div>;
}
