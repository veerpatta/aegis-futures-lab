"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getNeon, type EngineRunRow, type SignalRow } from "@/lib/neon/client";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";
import { useNowSec } from "@/components/signals/useSignalFeed";
import { WidgetIcon } from "@/components/widgets/TradingWidgets";
import { parseDailyFunnel, type DailyFunnelPayload } from "@/lib/signals/daily-funnel";
import { visibleSignals } from "@/lib/signals/snapshot";
import { failedComponents, COMPONENT_LABELS } from "@/lib/engine/markers";
import { FILLED } from "@/lib/experiment/opportunities";
import { calendarDay, previousDay, dayBounds, latestPolicies, canonicalStream, sourceName, pauseTrigger, recoveryWords, SOURCE_GATES } from "@/lib/plain/activity";
import { skipWords, decisionExplanation, versionName } from "@/lib/plain/experiment";
import { BREAKER_RULES } from "@/lib/engine/breaker-evidence";
import { readSourceActivity, SOURCE_STATE_WORDS } from "@/lib/engine/activity";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { money } from "@/lib/format";
import { stampIn, clockIn } from "@/lib/time/zones";
import s from "./activity.module.css";

interface Snapshot { day: string; zone: string; campaign: string | null; runs: EngineRunRow[]; signals: SignalRow[]; decisions: ExpTradeRow[]; funnel: DailyFunnelPayload | null; at: number }
/** A failed page must never become a zero total. All reads are paged. */
async function pages<T>(query: (offset: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const r = await query(offset);
    if (r.error) throw new Error(r.error.message);
    rows.push(...(r.data ?? []) as T[]);
    if ((r.data?.length ?? 0) < 500) return rows;
  }
  throw new Error("Activity exceeds the readable window.");
}

export default function ActivityPanel() {
  const health = useBotHealth(), exp = useExperiment(), { zone } = useZone(), { mask } = usePrivacy();
  const now = useNowSec(), today = now === null ? "" : calendarDay(now, zone);
  const [selected, setSelected] = useState(""), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false);
  const request = useRef(0), busy = useRef(false);
  const day = selected || today, campaign = exp.data?.experiment.id ?? null;
  const load = useCallback(async () => {
    if (!day) return;
    const id = ++request.current;
    busy.current = true; setLoading(true); setFailed(false);
    try {
      const db = getNeon(), { start, end } = dayBounds(day, zone);
      const [runs, signals, decisions, funnel] = await Promise.all([
        pages<EngineRunRow>(o => db.from("engine_runs").select("*").gte("ran_at", start).lt("ran_at", end).order("ran_at", { ascending: false }).order("id", { ascending: false }).range(o, o + 499)),
        pages<SignalRow>(o => db.from("signals").select("*").gte("signal_ts", start).lt("signal_ts", end).order("signal_ts", { ascending: false }).order("id", { ascending: false }).range(o, o + 499)),
        campaign ? pages<ExpTradeRow>(o => db.from("experiment_trades").select("id,action,reason,decided_at,recorded_at,observed_at,experiment_id,campaign,symbol,p_win,threshold,ref_price,idea,model_version_id").eq("experiment_id", campaign).gte("decided_at", start).lt("decided_at", end).order("decided_at", { ascending: false }).order("id", { ascending: false }).range(o, o + 499)) : Promise.resolve([]),
        db.from("learned_stats").select("payload").eq("stat_key", "daily_funnel").lt("computed_at", end).order("computed_at", { ascending: false }).limit(1),
      ]);
      if (funnel.error) throw new Error(funnel.error.message);
      if (id !== request.current) return;
      setSnapshot({ day, zone, campaign, runs, signals, decisions, funnel: parseDailyFunnel(funnel.data?.[0]?.payload), at: Date.now() });
    } catch { if (id === request.current) setFailed(true); }
    finally { if (id === request.current) { busy.current = false; setLoading(false); } }
  }, [day, zone, campaign]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load, health.revision]);
  useLiveRefresh(() => { if (!busy.current) void load(); }, 60_000);
  const data = snapshot?.day === day && snapshot.zone === zone && snapshot.campaign === campaign ? snapshot : null;
  const policies = latestPolicies(health.policy, day ? dayBounds(day, zone).end : undefined), funnel = data?.funnel;
  const sources = funnel?.streams.length ? funnel.streams.map(stream => ({ ...stream, key: canonicalStream(stream.key) })) : [...policies].filter(([, p]) => p.action === "paused").map(([key]) => ({ key, label: sourceName(key), tier: "B" as const, status: "benched" as const, signalsToday: 0, breaker: undefined }));
  const paused = sources.filter(stream => stream.breaker?.paused ?? (policies.get(stream.key)?.action === "paused" || stream.status === "benched"));
  const eligible = data ? visibleSignals(data.signals).filter(row => FILLED.has(row.status)).length : null;
  const taken = data?.decisions.filter(d => d.action === "take").length ?? null, skipped = data?.decisions.filter(d => d.action === "skip").length ?? null;
  const reasons: Record<string, number> = {};
  for (const d of data?.decisions ?? []) if (d.action === "skip") reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  const current = day === today, outcome = readSourceActivity(health.lastRun?.message ?? null);
  const fault = current && (health.loadFailed || health.stale || health.lastRun?.status === "error" || health.failing.length > 0 || outcome?.state === "component-error");
  const title = failed ? "Activity could not refresh" : fault ? "A check needs attention" : paused.length ? "Source methods paused" : data && eligible === 0 ? "No eligible source ideas recorded" : "Market activity";

  return <section className={s.panel} aria-label="Trading activity">
    <div className={s.heading}><span className={s.eyebrow}><WidgetIcon name="activity" /> Behind the trades</span><button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh trading activity">{loading ? "Checking" : "Refresh"}</button></div>
    <h2>{title}</h2>
    {fault && <p className={s.warning}>{health.loadFailed ? "The latest health read failed." : health.lastRun?.status === "error" ? "The last source check failed." : health.failing.length || outcome?.state === "component-error" ? "A component reported a problem inside the source check." : "The latest scheduled check is overdue."} Open the timeline and recorded messages for the saved evidence.</p>}
    {current && health.asleep && <p className={s.note}>Market closed · scheduled checks rest until reopening. The last recorded source state remains below.</p>}
    {current && outcome && <p className={s.note}>{SOURCE_STATE_WORDS[outcome.state]} · Recorded {stampIn(Date.parse(outcome.observedAt) / 1000, zone)}.</p>}
    <p className={s.intro}>{paused.length ? `${paused.length} source method${paused.length === 1 ? " is" : "s are"} withheld from the learner. Their separate practice simulations continue.` : "Follow market checks, source ideas and the learner's decisions."}</p>
    <div className={s.dateRow}><label>Day to review <input type="date" value={day} max={today} onChange={e => setSelected(e.target.value)} /></label><div className={s.segment}><button type="button" aria-pressed={day === today} onClick={() => setSelected("")}>Today</button><button type="button" aria-pressed={!!today && day === previousDay(today)} onClick={() => today && setSelected(previousDay(today))}>Yesterday</button></div></div>
    <p className={s.note}>{day} · Calendar day in {zone}. Checks use receipt time; ideas and decisions use simulated market time.</p>
    {(!exp.online || failed || health.loadFailed) && <p className={s.warning} role="status">{!exp.online ? "Offline. " : "Refresh failed. "}{data ? `Showing the saved update from ${stampIn(data.at / 1000, zone)}.` : "Activity counts are unavailable."} <button type="button" onClick={() => { health.refresh(); exp.refresh(); void load(); }}>Try again</button></p>}
    <div className={s.flow} aria-label="Daily activity summary" aria-busy={loading}>
      {[{ label: "Source checks", value: data?.runs.length, note: data ? `${data.runs.filter(r => r.status === "ok").length} succeeded` : "Awaiting records" }, { label: "Eligible ideas", value: eligible, note: "Source guard passed" }, { label: "Accepted", value: campaign ? taken : null, note: "Simulated decisions" }, { label: "Skipped", value: campaign ? skipped : null, note: "Learner decisions" }].map((tile, i) => <div className={s.tile} key={tile.label}><span className={s.step}>{i + 1}</span><b className="num">{tile.value ?? "—"}</b><strong>{tile.label}</strong><small>{tile.note}</small></div>)}
    </div>
    {exp.data && <p className={s.note}>Campaign {exp.data.experiment.campaign} · {campaign} · {versionName(exp.data.model?.version_id)}. Accepted ideas still need a valid next price to fill.</p>}
    {data && <p className={s.note}>{data.signals.filter(r => r.suppressed && !r.orphaned).length} source ideas withheld by pauses · {data.signals.filter(r => r.stale_data && !r.orphaned).length} flagged for stale data. Flags may overlap. Source practice never changes the learner&apos;s balance.</p>}
    <div className={s.sources}>{sources.map(stream => {
      const b = stream.breaker, p = policies.get(stream.key), isPaused = b?.paused ?? (p?.action === "paused" || stream.status === "benched");
      return <details className={`${s.source} ${isPaused ? s.paused : ""}`} key={stream.key}>
        <summary><span className={s.sourceIcon}><WidgetIcon name={isPaused ? "shield" : "activity"} /></span><span><b>{sourceName(stream.key)}</b><small>{b?.error ? "Source status could not be measured" : isPaused ? "Practising separately · no learner entries" : stream.status === "stale-data" ? "Price data needs checking" : "Watching at the saved check"}</small></span><span className={s.badge}>{b?.error ? "Check failed" : isPaused ? "Strategy paused" : stream.status === "stale-data" ? "Data delayed" : "Source active"}</span></summary>
        <div className={s.sourceBody}>{isPaused ? <><p>{pauseTrigger(b, p)}</p><p>{recoveryWords(b)}</p>
          {b && !b.error && <><label className={s.progressLabel}>Closed practice results <span>{Math.min(BREAKER_RULES.resumeWindow, b.recoveryCount)}/{BREAKER_RULES.resumeWindow}</span></label><progress max={BREAKER_RULES.resumeWindow} value={Math.min(BREAKER_RULES.resumeWindow, b.recoveryCount)} aria-label={`${sourceName(stream.key)} recovery results`} /></>}
          <p className={s.note}>Resumes after {BREAKER_RULES.resumeWindow} closed practice results with a profit-to-loss ratio of at least {BREAKER_RULES.resumePf.toFixed(2)} (or wins with no losses), and at least {BREAKER_RULES.tradingDays} trading days between changes. Filling the progress bar alone does not pass the guard.</p>
          {(b?.pausedAt ?? p?.changed_at) && <p className={s.note}>Pause recorded {stampIn(Date.parse(b?.pausedAt ?? p!.changed_at) / 1000, zone)}.</p>}
        </> : <p>{b?.error ?? "This source may publish eligible setups. Its entry, data and risk rules still apply."}</p>}
          <p className={s.note}>{b ? `Recovery measured ${stampIn(Date.parse(b.measuredAt) / 1000, zone)}. Newly closed results are seen on the next source check.` : "This older update has no saved recovery measurements."}</p>
        </div>
      </details>;
    })}{!sources.length && <p className={s.note}>{loading ? "Reading source status…" : "No source status snapshot available. A quiet ledger cannot prove the methods are active."}</p>}</div>
    {Object.keys(reasons).length > 0 && <details className={s.detail}><summary>Learner skips · {skipped} decisions</summary><ul>{Object.entries(reasons).map(([reason, n]) => <li key={reason}><b>{n}</b> {skipWords(reason)}</li>)}</ul><div className={s.decisions}>{data?.decisions.filter(d => d.action === "skip").slice(0, 10).map(d => <details key={d.id}><summary>{clockIn(Date.parse(d.decided_at) / 1000, zone)} {zone} · {d.symbol} · {skipWords(d.reason)}</summary><div><p>{decisionExplanation(d, n => mask(money(n, false))).join(" ")}</p><Link href={`/trades/${d.id}`}>Open saved decision →</Link></div></details>)}</div></details>}
    {funnel && Number.isFinite(Date.parse(funnel.computedAt)) && <details className={s.detail}><summary>Source setup checks · Session {funnel.dateKey} ET</summary><p className={s.note}>Recorded {stampIn(Date.parse(funnel.computedAt) / 1000, zone)}. Repeated strategy checks across price bars, not skipped learner trades. This exchange session can span two {zone} calendar days.</p><ul>{Object.entries(funnel.funnel).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, n]) => <li key={key}><b className="num">{n}</b> {SOURCE_GATES[key] ?? `Recorded source rule: ${key}`}</li>)}</ul></details>}
    {data && <details className={s.detail}><summary>Check timeline · latest {Math.min(8, data.runs.length)} of {data.runs.length}</summary><ol className={s.timeline}>{data.runs.slice(0, 8).map(run => <li key={run.id}><i className={run.status === "error" ? s.errorDot : ""} /><div><b>{stampIn(Date.parse(run.ran_at) / 1000, zone)}</b><p>{run.status === "error" ? "Source check failed" : run.status === "skipped" ? "Source check skipped" : "Source check completed"}</p>{failedComponents(run.message).length > 0 && <p className={s.warning}>{failedComponents(run.message).map(c => COMPONENT_LABELS[c]).join(", ")} failed inside this check.</p>}<details><summary>Recorded message</summary><p>{run.message ?? "No message saved."}</p></details></div></li>)}</ol>{!data.runs.length && <p className={s.note}>{current && health.asleep ? "No checks recorded. The scheduler rests while the market is closed." : "No source checks recorded for this calendar day. Check the schedule before assuming a quiet market."}</p>}</details>}
    {data && <p className={s.updated}>Read {stampIn(data.at / 1000, zone)} · Virtual only · Delayed prices</p>}
  </section>;
}
