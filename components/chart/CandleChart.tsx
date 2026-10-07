"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/types";
import { clockIn, dateShortIn, stampIn, type DisplayZone } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { ZoneBoxPrimitive, type ZoneBox } from "./zoneBoxes";

export type { ZoneBox };

export interface TradeMarker {
  time: number;
  /* entryLong/entryShort/exit = engine trades; the user* kinds are the
     user's own journaled trades, rendered in amber so the two ledgers stay
     visually distinct. */
  kind: "entryLong" | "entryShort" | "exit" | "userEntryLong" | "userEntryShort" | "userExit";
  text?: string;
}

export interface PriceLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

/* Module-level empties. A `= []` default is a NEW array on every render, and
   these props feed effects — a fresh default would re-run them every time the
   parent re-renders (the Chart tab re-renders every second for its clock). */
const EMPTY_MARKERS: TradeMarker[] = [];
const EMPTY_LINES: PriceLine[] = [];
const EMPTY_BOXES: ZoneBox[] = [];

/* Tall enough to read candles on a phone, never taller than most of the
   screen. autoSize follows the container, so the container carries it. */
const DEFAULT_HEIGHT = "clamp(280px, 55vh, 460px)";

const TWO_HOURS = 2 * 60 * 60;

/* Chart colours have to be literal strings for the canvas, so they are read
   from the CSS tokens at runtime. The fallbacks are the real token values
   from app/globals.css (design-language §8 item 5). */
export function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function palette() {
  return {
    textFaint: token("--text-faint", "#5b6a83"),
    border: token("--border", "#1b2536"),
    green: token("--green", "#2dd4a0"),
    red: token("--red", "#ff6b7a"),
    amber: token("--amber", "#f5b452"),
    blue: token("--blue", "#5aa7ff"),
  };
}

/* Without these the axis is UTC — the strategy, the markers and the journal
   are not, so the ticks would disagree with everything else. */
function zoneOptions(zone: DisplayZone) {
  return {
    timeScale: {
      tickMarkFormatter: (time: Time, tickMarkType: number) => {
        const sec = time as number;
        return tickMarkType <= 2 ? dateShortIn(sec, zone) : clockIn(sec, zone);
      },
    },
    localization: {
      timeFormatter: (time: Time) => stampIn(time as number, zone),
    },
  };
}

function toMarkers(markers: TradeMarker[], c: ReturnType<typeof palette>): SeriesMarker<Time>[] {
  return markers.map((m) => ({
    time: m.time as UTCTimestamp,
    position:
      m.kind === "entryShort" || m.kind === "userEntryShort"
        ? "aboveBar"
        : m.kind === "entryLong" || m.kind === "userEntryLong"
          ? "belowBar"
          : "inBar",
    color:
      m.kind === "entryLong"
        ? c.green
        : m.kind === "entryShort"
          ? c.red
          : m.kind === "exit"
            ? c.blue
            : c.amber,
    shape:
      m.kind === "entryLong" || m.kind === "userEntryLong"
        ? "arrowUp"
        : m.kind === "entryShort" || m.kind === "userEntryShort"
          ? "arrowDown"
          : m.kind === "userExit"
            ? "square"
            : "circle",
    text: m.text,
  }));
}

/* The chart and its series are built ONCE per mount. Data, price lines,
   markers, zones and the clock each update in their own effect, so a parent
   re-render never tears the chart down — which used to reset the reader's
   zoom and pan and make the candles flicker every second. */
export default function CandleChart({
  bars,
  markers = EMPTY_MARKERS,
  lines = EMPTY_LINES,
  boxes = EMPTY_BOXES,
  height = DEFAULT_HEIGHT,
  fitKey,
  focusTime = null,
}: {
  bars: Bar[];
  markers?: TradeMarker[];
  lines?: PriceLine[];
  /* Demand/supply zones as rectangles. Stop and target stay price LINES —
     they genuinely are lines; a zone genuinely is a band. */
  boxes?: ZoneBox[];
  /** Pixels, or any CSS length. Defaults to a phone-friendly clamp. */
  height?: number | string;
  /** The view refits to all bars only when this changes (e.g. symbol or
      timeframe). Left out, it refits whenever a new `bars` array arrives. */
  fitKey?: string;
  /** Unix seconds to bring into view (±2 hours, clamped to the data). */
  focusTime?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const boxPrimitiveRef = useRef<ZoneBoxPrimitive | null>(null);
  const lastFitRef = useRef<unknown>(undefined);
  const focusDoneRef = useRef<number | null>(null);
  const { zone } = useZone();
  const zoneRef = useRef(zone);
  zoneRef.current = zone;

  /* 1. Create the chart and the series — once. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const c = palette();
    const z = zoneOptions(zoneRef.current);

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.textFaint,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: c.border },
        horzLines: { color: c.border },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        ...z.timeScale,
      },
      localization: z.localization,
      crosshair: { mode: 0 },
      /* A vertical finger drag scrolls the page; a sideways drag pans the
         candles; two fingers zoom. */
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.green,
      downColor: c.red,
      wickUpColor: c.green,
      wickDownColor: c.red,
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
      boxPrimitiveRef.current = null;
      lastFitRef.current = undefined;
      focusDoneRef.current = null;
    };
  }, []);

  /* 2. The clock the axis is labelled in. */
  useEffect(() => {
    chartRef.current?.applyOptions(zoneOptions(zone));
  }, [zone]);

  /* 3. Bars. Fit to all of them only on the first load or when fitKey says
     the reader is looking at something different — never on a refresh. */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );
    const key = fitKey ?? bars;
    if (bars.length && lastFitRef.current !== key) {
      chart.timeScale().fitContent();
      lastFitRef.current = key;
    }
  }, [bars, fitKey]);

  /* 4. Price lines (previous close, entry, stop, target). */
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const pl of priceLinesRef.current) series.removePriceLine(pl);
    priceLinesRef.current = lines.map((line) =>
      series.createPriceLine({
        price: line.price,
        color: line.color,
        title: line.title,
        lineWidth: 1,
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
      })
    );
  }, [lines]);

  /* 5. Trade markers, through the v5 markers plugin. */
  useEffect(() => {
    markersRef.current?.setMarkers(markers.length ? toMarkers(markers, palette()) : []);
  }, [markers]);

  /* 6. Zones as rectangles. */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    if (boxPrimitiveRef.current) {
      series.detachPrimitive(boxPrimitiveRef.current);
      boxPrimitiveRef.current = null;
    }
    if (boxes.length) {
      const primitive = new ZoneBoxPrimitive(boxes, series, chart);
      series.attachPrimitive(primitive);
      boxPrimitiveRef.current = primitive;
    }
  }, [boxes]);

  /* 7. Bring one moment into view — once per focus time, after the bars it
     needs have arrived. The reader can pan away freely afterwards. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || focusTime === null || !bars.length || focusDoneRef.current === focusTime) return;
    const first = bars[0].time;
    const last = bars[bars.length - 1].time;
    let from = Math.max(first, focusTime - TWO_HOURS);
    let to = Math.min(last, focusTime + TWO_HOURS);
    if (to <= from) {
      // The moment is outside the loaded window: show the nearest edge.
      if (focusTime > last) {
        to = last;
        from = Math.max(first, last - 2 * TWO_HOURS);
      } else {
        from = first;
        to = Math.min(last, first + 2 * TWO_HOURS);
      }
    }
    focusDoneRef.current = focusTime;
    if (to <= from) return;
    chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
  }, [focusTime, bars]);

  return (
    <div
      ref={containerRef}
      style={{
        minWidth: 0,
        position: "relative",
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}
