"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EquityPoint } from "@/lib/types";
import { dateShortIn, type DisplayZone } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import styles from "./EquityChart.module.css";

export interface EquitySeries {
  label: string;
  color: string; // resolved CSS color (ramp token value)
  points: EquityPoint[];
}

/* The viewBox width tracks the container's CSS pixel width (ResizeObserver),
   so text renders at its true font size at every screen size instead of
   scaling down with a fixed 720-wide viewBox. */
const DEFAULT_W = 720;

function fmtMoney(v: number): string {
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtMoneyTick(v: number, compact: boolean): string {
  if (compact && Math.abs(v) >= 10000) {
    return `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1000).toFixed(1)}k`;
  }
  return fmtMoney(v);
}

/* Date ticks follow the zone picked in the nav, like every other time in the
   app — an equity curve read next to the blotter must use the same calendar. */
function fmtDate(sec: number, zone: DisplayZone): string {
  return dateShortIn(sec, zone);
}

export default function EquityChart({
  series,
  baseline,
}: {
  series: EquitySeries[];
  baseline?: number;
}) {
  const { zone } = useZone();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [w, setW] = useState(DEFAULT_W);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Measure synchronously on mount (don't depend on the first RO tick),
    // then let the observer track subsequent resizes.
    const initial = Math.round(el.getBoundingClientRect().width);
    if (initial > 0) setW(initial);
    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width > 0) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = w < 480 ? 200 : 220;
  const compact = w < 480;
  const pad = { top: 10, right: 12, bottom: 22, left: compact ? 44 : 52 };

  const domain = useMemo(() => {
    const pts = series.flatMap((s) => s.points);
    if (!pts.length) return null;
    const t0 = Math.min(...pts.map((p) => p.time));
    const t1 = Math.max(...pts.map((p) => p.time));
    let e0 = Math.min(...pts.map((p) => p.equity));
    let e1 = Math.max(...pts.map((p) => p.equity));
    if (baseline !== undefined) {
      e0 = Math.min(e0, baseline);
      e1 = Math.max(e1, baseline);
    }
    const padY = Math.max(1, (e1 - e0) * 0.08);
    return { t0, t1: Math.max(t1, t0 + 1), e0: e0 - padY, e1: e1 + padY };
  }, [series, baseline]);

  if (!domain) return <div className={styles.emptyNote}>No equity points.</div>;

  const x = (t: number) =>
    pad.left + ((t - domain.t0) / (domain.t1 - domain.t0)) * (w - pad.left - pad.right);
  const y = (e: number) =>
    h - pad.bottom - ((e - domain.e0) / (domain.e1 - domain.e0)) * (h - pad.top - pad.bottom);

  const yTicks = 4;
  const tickVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => domain.e0 + ((domain.e1 - domain.e0) * i) / yTicks
  );
  const xTickCount = w < 440 ? 3 : 4;
  const xTickTimes = Array.from(
    { length: xTickCount },
    (_, i) => domain.t0 + ((domain.t1 - domain.t0) * (i + 0.5)) / xTickCount
  );

  const hoverTime =
    hoverX === null
      ? null
      : domain.t0 + ((hoverX - pad.left) / (w - pad.left - pad.right)) * (domain.t1 - domain.t0);

  const hoverRows =
    hoverTime === null
      ? []
      : series
          .map((s) => {
            let best: EquityPoint | null = null;
            for (const p of s.points) {
              if (p.time <= hoverTime) best = p;
              else break;
            }
            return best ? { label: s.label, color: s.color, point: best } : null;
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

  /* Pointer events serve mouse and touch alike: hover tracks on mouse, a tap
     or drag sets the crosshair on touch (persists until the next tap). The
     viewBox width equals CSS pixels, so no coordinate scaling is needed. */
  const setFromClientX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    setHoverX(px >= pad.left && px <= w - pad.right ? px : null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" || e.buttons > 0) setFromClientX(e.clientX);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setFromClientX(e.clientX);
  };

  const onPointerLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse") setHoverX(null);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      {series.length > 1 && (
        <div className={styles.legend}>
          {series.map((s) => (
            <span key={s.label} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className={styles.svg}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        role="img"
        aria-label="Equity curve"
      >
        {tickVals.map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={y(v)}
              y2={y(v)}
              className={styles.gridLine}
            />
            <text x={pad.left - 6} y={y(v) + 3.5} className={styles.tickLabel} textAnchor="end">
              {fmtMoneyTick(v, compact)}
            </text>
          </g>
        ))}
        {xTickTimes.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={h - 6}
            className={styles.tickLabel}
            textAnchor="middle"
          >
            {fmtDate(t, zone)}
          </text>
        ))}
        {baseline !== undefined && (
          <line
            x1={pad.left}
            x2={w - pad.right}
            y1={y(baseline)}
            y2={y(baseline)}
            className={styles.baseline}
          />
        )}
        {series.map((s) => (
          <path
            key={s.label}
            d={s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${y(p.equity).toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hoverX !== null && (
          <line x1={hoverX} x2={hoverX} y1={pad.top} y2={h - pad.bottom} className={styles.crosshair} />
        )}
        {hoverRows.map((r) => (
          <circle
            key={r.label}
            cx={x(r.point.time)}
            cy={y(r.point.equity)}
            r={4}
            fill={r.color}
            className={styles.hoverDot}
          />
        ))}
      </svg>
      {hoverRows.length > 0 && hoverTime !== null && (
        <div className={styles.tooltip}>
          <span className={styles.tooltipTime}>{fmtDate(hoverTime, zone)}</span>
          {hoverRows.map((r) => (
            <span key={r.label} className={styles.tooltipRow}>
              <span className={styles.swatch} style={{ background: r.color }} />
              {r.label}: <b>{fmtMoney(r.point.equity)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
