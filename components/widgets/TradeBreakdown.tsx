"use client";

import { useMemo } from "react";
import type { ExpTradeRow } from "@/lib/experiment/view";
import { WidgetIcon } from "./WidgetIcon";
import { decisionMix } from "@/lib/plain/desk";
import s from "./desk.module.css";

export function TradeBreakdown({ rows, loading, failed, more, earlier }: { rows: ExpTradeRow[]; loading: boolean; failed: boolean; more: boolean; earlier: boolean }) {
  const mix = useMemo(() => decisionMix(rows), [rows]);
  return <section className={s.breakdown} aria-label="Decisions in this view" aria-busy={loading}>
    <div className={s.rangeTitle}><b>Decisions in this view</b><span>{loading ? "Updating…" : `${rows.length} shown${more ? " · more below" : ""}`}</span></div>
    {rows.length ? <><div className={s.mixBar} role="img" aria-label={mix.map(x => `${x.count} ${x.label.toLowerCase()}`).join(", ")}>{mix.filter(x => x.count).map(x => <i key={x.key} className={s[x.key]} style={{ flexGrow: x.count }} />)}</div><div className={s.mixLegend}>{mix.map(x => <div key={x.key}><i className={s[x.key]} /><span>{x.label}</span><b>{x.count}</b></div>)}</div></> : <div className={s.emptyMix}><WidgetIcon name="activity" /><p>{loading ? "Building the picture from your records…" : failed ? "The records could not be checked." : "No decisions match this view yet."}</p></div>}
    <p className={s.caption}>{failed && rows.length ? "Saved rows shown; refresh failed. " : ""}{earlier ? "Earlier attempts only. " : ""}Counts follow the filter and loaded cards. A skipped or unfilled idea is not a closed trade.</p>
  </section>;
}
