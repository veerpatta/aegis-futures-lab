"use client";

import { useMemo, useRef, useState } from "react";
import type { EquityPoint } from "@/lib/types";
import styles from "./EquityChart.module.css";

export interface EquitySeries {
  label: string;
  color: string; // resolved CSS color (ramp token value)
  points: EquityPoint[];
}

const W = 720;
const H = 220;
const PAD = { top: 10, right: 12, bottom: 22, left: 52 };

function fmtMoney(v: number): string {
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function EquityChart({
  series,
  baseline,
}: {
  series: EquitySeries[];
  baseline?: number;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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
    PAD.left + ((t - domain.t0) / (domain.t1 - domain.t0)) * (W - PAD.left - PAD.right);
  const y = (e: number) =>
    H - PAD.bottom - ((e - domain.e0) / (domain.e1 - domain.e0)) * (H - PAD.top - PAD.bottom);

  const yTicks = 4;
  const tickVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => domain.e0 + ((domain.e1 - domain.e0) * i) / yTicks
  );
  const xTickTimes = Array.from(
    { length: 4 },
    (_, i) => domain.t0 + ((domain.t1 - domain.t0) * (i + 0.5)) / 4
  );

  const hoverTime =
    hoverX === null
      ? null
      : domain.t0 + ((hoverX - PAD.left) / (W - PAD.left - PAD.right)) * (domain.t1 - domain.t0);

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

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHoverX(px >= PAD.left && px <= W - PAD.right ? px : null);
  };

  return (
    <div className={styles.wrap}>
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
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverX(null)}
        role="img"
        aria-label="Equity curve"
      >
        {tickVals.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className={styles.gridLine}
            />
            <text x={PAD.left - 6} y={y(v) + 3.5} className={styles.tickLabel} textAnchor="end">
              {fmtMoney(v)}
            </text>
          </g>
        ))}
        {xTickTimes.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            className={styles.tickLabel}
            textAnchor="middle"
          >
            {fmtDate(t)}
          </text>
        ))}
        {baseline !== undefined && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
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
          <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={H - PAD.bottom} className={styles.crosshair} />
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
          <span className={styles.tooltipTime}>{fmtDate(hoverTime)}</span>
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
