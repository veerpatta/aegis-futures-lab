"use client";

import { useId } from "react";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import type { ExpOverview } from "@/lib/experiment/view";
import s from "./widgets.module.css";

import { WidgetIcon, type IconName } from "./WidgetIcon";
export { WidgetIcon, type IconName } from "./WidgetIcon";

/** Straight segments between recorded points only; never a decorative market curve. */
export function Sparkline({ points, label, baseline, tone = "blue" }: { points: { t: number; y: number }[]; label: string; baseline?: number; tone?: "good" | "bad" | "blue" }) {
  const id = useId().replace(/:/g, "");
  const valid = points.filter(p => Number.isFinite(p.t) && Number.isFinite(p.y)).sort((a, b) => a.t - b.t);
  if (valid.length < 2) return <div className={s.chartEmpty}>Chart builds as prices arrive</div>;
  const values = valid.map(p => p.y);
  if (baseline !== undefined) values.push(baseline);
  const low = Math.min(...values), high = Math.max(...values), pad = Math.max((high - low) * .15, .01);
  const y = (v: number) => 74 - ((v - low + pad) / (high - low + pad * 2)) * 64;
  const first = valid[0].t, span = Math.max(1, valid.at(-1)!.t - first);
  const xy = valid.map(p => `${4 + ((p.t - first) / span) * 292},${y(p.y)}`);
  return <svg className={`${s.spark} ${s[tone]}`} viewBox="0 0 300 84" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    <path d={`M${xy.join(" L")} L296,84 L4,84 Z`} fill={`url(#${id})`} />
    {baseline !== undefined && <path d={`M4 ${y(baseline)} H296`} className={s.baseline} />}
    <polyline points={xy.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="296" cy={y(valid.at(-1)!.y)} r="3" fill="currentColor" />
  </svg>;
}

export function EquityChart({ data, compact = false }: { data: ExpOverview; compact?: boolean }) {
  const { privacy } = usePrivacy();
  const a = data.account;
  if (!a) return null;
  const start = Date.parse(data.experiment.simulation_from ?? data.experiment.started_at);
  const points = [{ t: start, y: data.experiment.capital }, ...data.equity_eod.map(p => ({ t: Date.parse(p.as_of), y: p.equity }))];
  const latest = Date.parse(a.data_as_of ?? a.updated_at);
  if (Number.isFinite(latest) && latest > start) points.push({ t: latest, y: a.equity });
  return <div className={`${s.equityChart} ${compact ? s.smallChart : ""}`}>
    {privacy ? <div className={s.chartEmpty}>Account chart hidden</div> : <Sparkline points={points} baseline={data.experiment.capital} label={`Virtual equity from the starting balance through ${points.length - 1} recorded updates`} tone={a.equity >= data.experiment.capital ? "good" : "bad"} />}
    {!compact && <div className={s.chartCaption}><span>Account journey</span><span>{data.equity_eod.length ? "Daily closes + latest estimate" : "Starting balance → latest estimate"}</span></div>}
  </div>;
}

export function ProgressRing({ value, of, label }: { value: number; of: number; label: string }) {
  const fraction = Math.min(1, Math.max(0, value / Math.max(1, of)));
  return <div className={s.ring} role="img" aria-label={`${value} of ${of} ${label}`}>
    <svg viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r="42" className={s.ringTrack} /><circle cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${fraction * 100} 100`} className={s.ringFill} /></svg>
    <span><b className="num">{value}</b><small>of {of}</small></span>
  </div>;
}
