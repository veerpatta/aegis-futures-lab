"use client";

import { useId, type CSSProperties } from "react";
import Link from "next/link";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { money } from "@/lib/format";
import { marketName } from "@/lib/plain/idea";
import { COMMISSION_RT, pointValue } from "@/lib/experiment/policy";
import { stampIn } from "@/lib/time/zones";
import type { ExpOverview, ExpPositionRow, ExpTradeRow } from "@/lib/experiment/view";
import PriceLadder from "@/components/signals/PriceLadder";
import s from "./widgets.module.css";

export type IconName = "wallet" | "activity" | "learn" | "clock" | "arrow" | "check" | "pause" | "shield";
const paths: Record<IconName, string> = {
  wallet: "M20 8H5a2 2 0 0 1 0-4h13v4M4 6v12a2 2 0 0 0 2 2h14V8M20 12h-5v4h5",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  learn: "m3 8 9-5 9 5-9 5-9-5Zm4 3v6l5 3 5-3v-6M21 8v7",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  arrow: "M5 17 19 3M8 3h11v11",
  check: "m5 12 4 4L19 6",
  pause: "M9 5v14M15 5v14",
  shield: "m12 3 8 3v6c0 4-5 7-8 9-3-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6",
};
export function WidgetIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name]} /></svg>;
}

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

export function MetricTile({ label, value, note, icon, tone = "blue", onClick, active }: { label: string; value: string; note?: string; icon: IconName; tone?: "good" | "bad" | "blue" | "warn"; onClick?: () => void; active?: boolean }) {
  const body = <><span className={s.metricLabel}><WidgetIcon name={icon} />{label}</span><b className={`${s.metricValue} ${s[tone]} num`}>{value}</b>{note && <small>{note}</small>}</>;
  return onClick ? <button className={s.metric} type="button" onClick={onClick} aria-pressed={active}>{body}</button> : <div className={s.metric}>{body}</div>;
}

export function ProgressRing({ value, of, label }: { value: number; of: number; label: string }) {
  const fraction = Math.min(1, Math.max(0, value / Math.max(1, of)));
  return <div className={s.ring} role="img" aria-label={`${value} of ${of} ${label}`}>
    <svg viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r="42" className={s.ringTrack} /><circle cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${fraction * 100} 100`} className={s.ringFill} /></svg>
    <span><b className="num">{value}</b><small>of {of}</small></span>
  </div>;
}

type VisualTrade = Pick<ExpPositionRow, "symbol" | "side" | "qty" | "fill_price" | "mark" | "stale" | "exit_price" | "net" | "stop" | "target"> & {
  id: number; status: string | null; action: string; reason: string; at: string; provenance: string; markAt?: string | null;
};
export function positionVisual(p: ExpPositionRow): VisualTrade {
  return { ...p, id: p.decision_id, status: p.status, action: "take", reason: p.status === "closed" ? (p.exit_reason === "stop" ? "Stopped out" : p.exit_reason === "target" ? "Target reached" : "Trade closed") : p.status === "pending_fill" ? "Waiting for the next price" : "Open now", at: p.decided_at, markAt: p.mark_ts };
}
export function ledgerVisual(r: ExpTradeRow, reason: string): VisualTrade {
  return { ...r, stop: r.idea?.stop ?? NaN, target: r.idea?.target ?? null, stale: !!r.stale, status: r.position_status, reason, at: r.decided_at, markAt: r.mark_ts };
}
export function TradeWidget({ trade: t, compact = false, index = 0 }: { trade: VisualTrade; compact?: boolean; index?: number }) {
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const closed = t.status === "closed", open = t.status === "open", skip = t.action !== "take", cancelled = t.status === "cancelled";
  const value = closed ? t.net : open && t.mark != null && t.fill_price != null ? (t.mark - t.fill_price) * (t.side === "LONG" ? 1 : -1) * pointValue(t.symbol) * t.qty - COMMISSION_RT * t.qty : null;
  const tone = value === null || (t.stale && !closed) ? "muted" : value > 0 ? "good" : value < 0 ? "bad" : "muted";
  const status = skip ? "Skipped" : cancelled ? "Not filled" : closed ? t.reason : open ? "Open" : "Waiting";
  const marker = closed ? t.exit_price : open ? t.mark : null;
  return <Link href={`/trades/${t.id}`} className={`${s.trade} ${compact ? s.compact : ""}`} style={{ "--widget-delay": `${Math.min(index, 5) * 35}ms` } as CSSProperties}>
    <div className={s.tradeTop}>
      <span className={`${s.marketIcon} ${t.symbol === "MNQ" ? s.nasdaq : ""}`} aria-hidden>{t.symbol === "MES" ? "S&P" : "NQ"}</span>
      <span className={s.tradeName}><b>{marketName(t.symbol)}</b><small>{t.symbol} · {t.side === "LONG" ? "Long" : "Short"}{!skip ? ` · ${t.qty} contract${t.qty === 1 ? "" : "s"}${cancelled || (!closed && !open) ? " requested" : ""}` : ""}</small></span>
      <span className={`${s.status} ${s[skip || cancelled ? "muted" : closed ? tone : "blue"]}`}>{status}</span>
    </div>
    <div className={s.tradeResult}><span>{skip ? "Decision" : cancelled ? "Order result" : closed ? "Final result" : open ? t.stale ? "Last estimate · stale" : "Open result · estimated" : "Order placed"}</span><b className={`${s[tone]} num`}>{value === null ? skip ? "Not taken" : cancelled ? "No fill" : "Pending" : `${t.stale && !closed ? "~" : ""}${mask(money(value))}`}</b></div>
    {!compact && !skip && !cancelled && t.fill_price != null && Number.isFinite(t.stop) && <div className={s.priceWidget}><PriceLadder stop={t.stop} entry={t.fill_price} target={t.target} marker={marker} markerLabel={closed ? "Exit price" : "Last delayed price"} /></div>}
    {!compact && (skip || cancelled || (!open && !closed)) && <p className={s.tradeReason}>{t.reason}</p>}
    {!compact && !skip && !cancelled && <div className={s.tradeSteps} aria-label="Trade progress"><span className={s.stepDone}><i />Idea</span><span className={t.fill_price == null ? "" : s.stepDone}><i />Filled</span><span className={closed ? s.stepDone : ""}><i />{closed ? "Closed" : "Exit ahead"}</span></div>}
    <div className={s.tradeFoot}><span>{stampIn(Date.parse(t.at) / 1000, zone)}</span><span>{t.provenance === "replay" ? "Replay" : t.provenance === "synthetic" ? "Synthetic" : t.provenance === "late" ? "Caught up late" : "Delayed"} <span aria-hidden>↗</span></span></div>
    {open && t.markAt && <span className="sr-only">Marked {stampIn(Date.parse(t.markAt) / 1000, zone)} · delayed. Estimate after modeled costs.</span>}
  </Link>;
}
