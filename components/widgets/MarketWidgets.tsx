"use client";

import { useMemo } from "react";
import { useZone } from "@/components/providers/ZoneProvider";
import { stampIn } from "@/lib/time/zones";
import { fmtCountdown, marketPhase, sessionRemainingSec } from "@/lib/time/session";
import { nyMeta } from "@/lib/time/ny";
import type { Bar } from "@/lib/types";
import { WidgetIcon } from "./WidgetIcon";
import { loadedRange } from "@/lib/plain/desk";
import s from "./desk.module.css";

export function SessionClock({ now }: { now: number | null }) {
  const phase = now === null ? null : marketPhase(now);
  const remaining = now === null ? null : sessionRemainingSec(now);
  const elapsed = now === null || remaining === null ? 0 : (nyMeta(now).minutes - 120) * 60 + now % 60;
  const fraction = remaining === null ? 0 : elapsed / Math.max(1, elapsed + remaining);
  return <section className={s.session} aria-label="Market clock">
    <div className={s.clock} aria-hidden="true"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" className={s.track} /><circle cx="40" cy="40" r="32" className={s.clockFill} pathLength="100" strokeDasharray={`${fraction * 100} 100`} /></svg><WidgetIcon name={remaining === null ? "pause" : "clock"} /></div>
    <div className={s.sessionCopy}><span className={s.eyebrow}>Market clock</span><h2>{phase?.label ?? "Checking the session"}</h2><p>{phase?.detail ?? "The session follows New York time."}</p>{remaining !== null && <b>{fmtCountdown(remaining)} <span>left for new entries</span></b>}</div>
  </section>;
}

export function PriceRange({ bars }: { bars: Bar[] }) {
  const { zone } = useZone();
  const range = useMemo(() => loadedRange(bars), [bars]);
  const price = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!range) return null;
  return <section className={s.range} aria-label="Range on this chart">
    <div className={s.rangeTitle}><b>Range on this chart</b><span>{range.n.toLocaleString()} candles</span></div>
    <div className={s.rangeNumbers}><div><small>Low</small><b>{price(range.low)}</b></div><div><small>Last close</small><b>{price(range.last)}</b></div><div><small>High</small><b>{price(range.high)}</b></div></div>
    <div className={s.rangeTrack} role="img" aria-label={`Last close ${price(range.last)}, range ${price(range.low)} to ${price(range.high)}`}><i style={{ left: `${range.fraction * 100}%` }} /></div>
    <p className={s.caption}>{stampIn(range.from, zone)} → {stampIn(range.to, zone)}. Loaded candles, not a forecast.</p>
  </section>;
}
