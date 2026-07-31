/* Demand/supply zones drawn as RECTANGLES, not flat lines.
   ─────────────────────────────────────────────────────────────────────────
   A zone is a band between two prices — the proximal line you enter at and
   the distal line your stop sits beyond. Drawing it as a single price line
   throws away the half that decides your risk, and a trader reading the chart
   cannot see whether price is at the edge of the zone or has eaten through it.

   Implemented as a lightweight-charts v5 series primitive so it uses the
   charting library already in the bundle — no new dependency. */

import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface ZoneBox {
  /** The line price enters at — the near edge. */
  proximal: number;
  /** The far edge; the structural stop sits just beyond it. */
  distal: number;
  kind: "demand" | "supply";
  /** Dims the fill as a zone is used up. 1 = untouched. */
  freshness?: number;
  label?: string;
  /** Optional left edge; zones extend to the right edge regardless. */
  fromTime?: Time;
}

/* The zone → box mapping, kept here and tested rather than inlined in a
   component, because the asymmetry is the easiest thing in this feature to
   get backwards and the hardest to notice when you do.

   Price falls INTO a demand zone from above, so its proximal (the line you
   enter at) is the zone's HIGH and the stop sits below its LOW. A supply zone
   is the mirror. Swap them and every stop is drawn on the wrong side of every
   entry — a chart that looks fine and teaches the wrong thing. */
export interface ZoneLike {
  zone_type: "demand" | "supply";
  price_high: number;
  price_low: number;
  status: "fresh" | "tested" | "broken";
  timeframe: string;
}

export function zoneToBox(z: ZoneLike): ZoneBox {
  const demand = z.zone_type === "demand";
  return {
    proximal: demand ? z.price_high : z.price_low,
    distal: demand ? z.price_low : z.price_high,
    kind: z.zone_type,
    freshness: z.status === "fresh" ? 1 : 0.45,
    label: `${z.timeframe} ${demand ? "buy" : "sell"}${z.status === "fresh" ? " · fresh" : " · tested"}`,
  };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/* Read the theme's own colours rather than hardcoding hexes, so the boxes
   follow the palette like everything else on the page. */
function tokenRgb(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return fallback;
}

const rgba = (c: Rgb, a: number) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

class ZoneBoxRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly boxes: ZoneBox[],
    private readonly series: ISeriesApi<SeriesType>,
    private readonly chart: IChartApi
  ) {}

  draw(target: {
    useMediaCoordinateSpace: (
      cb: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void
    ) => void;
  }): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const demand = tokenRgb("--green", { r: 45, g: 212, b: 160 });
      const supply = tokenRgb("--red", { r: 255, g: 107, b: 122 });

      for (const box of this.boxes) {
        const yA = this.series.priceToCoordinate(box.proximal);
        const yB = this.series.priceToCoordinate(box.distal);
        if (yA === null || yB === null) continue;

        const top = Math.min(yA, yB);
        const height = Math.max(1, Math.abs(yA - yB));
        let left = 0;
        if (box.fromTime !== undefined) {
          const x = this.chart.timeScale().timeToCoordinate(box.fromTime);
          if (x !== null) left = Math.max(0, x);
        }
        const width = Math.max(0, mediaSize.width - left);
        if (width <= 0) continue;

        const colour = box.kind === "demand" ? demand : supply;
        // Freshness fades the fill: a zone price has already chewed through
        // should not shout as loudly as an untouched one.
        const fresh = Math.max(0, Math.min(1, box.freshness ?? 1));
        const fillAlpha = 0.06 + 0.1 * fresh;

        ctx.fillStyle = rgba(colour, fillAlpha);
        ctx.fillRect(left, top, width, height);

        /* The PROXIMAL edge is drawn solid and the distal dashed. That is the
           whole reason for the rectangle: entry sits on one line and the stop
           beyond the other, and a trader has to be able to tell them apart at
           a glance. */
        const yProximal = yA;
        const yDistal = yB;

        ctx.strokeStyle = rgba(colour, 0.55 + 0.35 * fresh);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(left, yProximal);
        ctx.lineTo(left + width, yProximal);
        ctx.stroke();

        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(left, yDistal);
        ctx.lineTo(left + width, yDistal);
        ctx.stroke();
        ctx.setLineDash([]);

        if (box.label && height >= 12) {
          ctx.fillStyle = rgba(colour, 0.95);
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "top";
          ctx.fillText(box.label, left + 6, top + 2);
        }
      }
    });
  }
}

class ZoneBoxPaneView implements IPrimitivePaneView {
  constructor(
    private readonly boxes: ZoneBox[],
    private readonly series: ISeriesApi<SeriesType>,
    private readonly chart: IChartApi
  ) {}

  /* Behind the candles. A zone is context; it must never obscure the price
     action a reader is actually judging. */
  zOrder() {
    return "bottom" as const;
  }

  renderer() {
    return new ZoneBoxRenderer(this.boxes, this.series, this.chart) as IPrimitivePaneRenderer;
  }
}

export class ZoneBoxPrimitive implements ISeriesPrimitive<Time> {
  private views: ZoneBoxPaneView[] = [];

  constructor(
    private readonly boxes: ZoneBox[],
    private readonly series: ISeriesApi<SeriesType>,
    private readonly chart: IChartApi
  ) {
    this.views = [new ZoneBoxPaneView(boxes, series, chart)];
  }

  paneViews() {
    return this.views;
  }

  updateAllViews() {
    /* Views read live from the series/chart on every draw, so there is no
       cached geometry to refresh. */
  }

  /* Without this the price scale ignores the boxes, and a zone sitting off the
     current range is invisible with nothing to say it is there. Widening the
     autoscale to include every zone is the difference between "no zone nearby"
     and "the zone is off-screen". */
  autoscaleInfo() {
    if (!this.boxes.length) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const b of this.boxes) {
      min = Math.min(min, b.proximal, b.distal);
      max = Math.max(max, b.proximal, b.distal);
    }
    return Number.isFinite(min) && Number.isFinite(max)
      ? { priceRange: { minValue: min, maxValue: max } }
      : null;
  }
}
