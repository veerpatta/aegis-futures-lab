"use client";

/* The Markets hero's price line — the design's glance chart.

   A filled area under a single stroke, with a dashed line at the previous
   close so "up or down on the day" is readable without touching a number. The
   stroke follows the day's direction rather than being fixed green, so the
   card reads red on a down day.

   The candle chart is still one tap away on the same card; this is the shape
   the screen opens with. */

import type { Bar } from "@/lib/types";

const W = 320;
const H = 108;
const PAD = 6;

export default function PriceArea({
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
  const closes = bars.map((b) => b.close);
  if (closes.length < 2) return null;

  /* The reference line has to share the scale, or it lands off the card. */
  const lo = Math.min(...closes, previousClose ?? Infinity);
  const hi = Math.max(...closes, previousClose ?? -Infinity);
  const span = hi - lo || 1;
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const x = (i: number) => (i / (closes.length - 1)) * W;

  const line = closes.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const stroke = up ? "var(--green)" : "var(--red)";
  const gradId = up ? "areaUp" : "areaDown";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="marketsArea"
      role="img"
      aria-label={label}
      style={{ display: "block", width: "100%", height: 108, marginTop: 12 }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.3" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {previousClose !== null && (
        <line
          x1="0"
          y1={y(previousClose).toFixed(1)}
          x2={W}
          y2={y(previousClose).toFixed(1)}
          stroke="rgba(90,167,255,.4)"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
