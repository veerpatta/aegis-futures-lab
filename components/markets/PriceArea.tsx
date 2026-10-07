"use client";

/* The Chart tab's price line — the glance chart the screen opens with.

   A filled area under a single stroke, with a dashed line at the previous
   close so "up or down on the day" is readable without touching a number. The
   stroke follows the day's direction rather than being fixed green, so the
   card reads red on a down day.

   Touch it (or move a mouse over it) and a readout shows the price and the
   time under your finger, in the clock picked in the header. A vertical drag
   still scrolls the page; a sideways drag scrubs. The scrubbing follows
   EquityChart.tsx: pointer events, and a viewBox that tracks the container's
   real pixel width so the labels render at their true size.

   The candle chart is one tap away on the same card. */

import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bar } from "@/lib/types";
import { dateTimeIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import styles from "./markets.module.css";

const DEFAULT_W = 320;
const H = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 22; // room for the start/end time labels
const GUTTER = 48; // room for the price labels on the right

/* A round step that gives about `target` gridlines across `span`. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

const priceLabel = (v: number, step: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: step < 1 ? 2 : 0,
    maximumFractionDigits: step < 1 ? 2 : 0,
  });

const priceFull = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function PriceArea({
  bars,
  previousClose,
  up,
  label,
}: {
  bars: Bar[];
  previousClose: number | null;
  up: boolean;
  label: string;
}) {
  const { zone } = useZone();
  /* useId's characters are not all safe inside url(#…). */
  const gradId = `area${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [w, setW] = useState(DEFAULT_W);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const initial = Math.round(el.getBoundingClientRect().width);
    if (initial > 0) setW(initial);
    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width > 0) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* A new window (symbol, timeframe, refresh) drops a stale crosshair. */
  useLayoutEffect(() => setHover(null), [bars]);

  const plotW = Math.max(1, w - GUTTER);
  const plotBottom = H - PAD_BOTTOM;

  const geo = useMemo(() => {
    const closes = bars.map((b) => b.close);
    if (closes.length < 2) return null;
    /* The reference line has to share the scale, or it lands off the card. */
    let lo = Math.min(...closes, previousClose ?? Infinity);
    let hi = Math.max(...closes, previousClose ?? -Infinity);
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    const y = (v: number) => plotBottom - ((v - lo) / span) * (plotBottom - PAD_TOP);
    const x = (i: number) => (i / (closes.length - 1)) * plotW;
    const line = closes
      .map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c).toFixed(1)}`)
      .join(" ");
    const step = niceStep(span, 3);
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    return { closes, lo, hi, y, x, line, step, ticks };
  }, [bars, previousClose, plotW, plotBottom]);

  if (!geo) return null;

  const stroke = up ? "var(--green)" : "var(--red)";
  const first = bars[0];
  const last = bars[bars.length - 1];

  const setFromClientX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = Math.min(Math.max(clientX - rect.left, 0), plotW);
    setHover(Math.round((px / plotW) * (geo.closes.length - 1)));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" || e.buttons > 0) setFromClientX(e.clientX);
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => setFromClientX(e.clientX);
  const onPointerLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse") setHover(null);
  };

  const hoverBar = hover === null ? null : bars[hover];

  return (
    <div ref={wrapRef} className={styles.areaWrap}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${H}`}
        className={styles.areaSvg}
        role="img"
        aria-label={label}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.3" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* A few faint price levels, labelled on the right edge. */}
        {geo.ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={plotW} y1={geo.y(v)} y2={geo.y(v)} className={styles.areaGrid} />
            <text x={w - 2} y={geo.y(v) + 4} textAnchor="end" className={styles.areaTick}>
              {priceLabel(v, geo.step)}
            </text>
          </g>
        ))}

        <path d={`${geo.line} L${plotW},${plotBottom} L0,${plotBottom} Z`} fill={`url(#${gradId})`} />
        <path
          d={geo.line}
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {previousClose !== null && (
          <line
            x1={0}
            y1={geo.y(previousClose)}
            x2={plotW}
            y2={geo.y(previousClose)}
            className={styles.areaPrev}
          />
        )}

        {/* Where the window starts and ends, in the clock picked in the header. */}
        <text x={0} y={H - 6} textAnchor="start" className={styles.areaTick}>
          {dateTimeIn(first.time, zone)}
        </text>
        <text x={plotW} y={H - 6} textAnchor="end" className={styles.areaTick}>
          {dateTimeIn(last.time, zone)} {ZONE_ABBR[zone]}
        </text>

        {hover !== null && hoverBar && (
          <g>
            <line
              x1={geo.x(hover)}
              x2={geo.x(hover)}
              y1={PAD_TOP}
              y2={plotBottom}
              className={styles.areaCross}
            />
            <circle cx={geo.x(hover)} cy={geo.y(hoverBar.close)} r={4} fill={stroke} className={styles.areaDot} />
          </g>
        )}
      </svg>
      {hoverBar && hover !== null && (
        /* Sits on the side away from the finger so it never covers the point being read. */
        <div
          className={styles.areaReadout}
          style={hover < geo.closes.length / 2 ? { left: "auto", right: GUTTER } : undefined}
        >
          <b className="num">{priceFull(hoverBar.close)}</b>
          <span>
            {dateTimeIn(hoverBar.time, zone)} {ZONE_ABBR[zone]}
          </span>
        </div>
      )}
    </div>
  );
}

/* Props are a memoised bar array and primitives, so the Chart tab's
   once-a-second clock re-render does not redraw the line. */
export default memo(PriceArea);
