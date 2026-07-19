"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/types";

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

export default function CandleChart({
  bars,
  markers = [],
  lines = [],
  height = 320,
}: {
  bars: Bar[];
  markers?: TradeMarker[];
  lines?: PriceLine[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;

    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("--text-faint", "#5b6a83"),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: token("--border", "#1a2436") },
        horzLines: { color: token("--border", "#1a2436") },
      },
      rightPriceScale: { borderColor: token("--border", "#1a2436") },
      timeScale: { borderColor: token("--border", "#1a2436"), timeVisible: true },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: token("--green", "#2dd4a0"),
      downColor: token("--red", "#ff6b7a"),
      wickUpColor: token("--green", "#2dd4a0"),
      wickDownColor: token("--red", "#ff6b7a"),
      borderVisible: false,
    });
    series.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    if (markers.length) {
      const amber = token("--amber", "#ffb454");
      const sm: SeriesMarker<Time>[] = markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position:
          m.kind === "entryShort" || m.kind === "userEntryShort"
            ? "aboveBar"
            : m.kind === "entryLong" || m.kind === "userEntryLong"
              ? "belowBar"
              : "inBar",
        color:
          m.kind === "entryLong"
            ? token("--green", "#2dd4a0")
            : m.kind === "entryShort"
              ? token("--red", "#ff6b7a")
              : m.kind === "exit"
                ? token("--blue", "#5aa7ff")
                : amber,
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
      createSeriesMarkers(series, sm);
    }
    for (const line of lines)
      series.createPriceLine({
        price: line.price,
        color: line.color,
        title: line.title,
        lineWidth: 1,
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
      });
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, markers, lines, height]);

  return <div ref={containerRef} style={{ minWidth: 0 }} />;
}
