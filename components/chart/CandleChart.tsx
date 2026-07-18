"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/types";

export interface TradeMarker {
  time: number;
  kind: "entryLong" | "entryShort" | "exit";
  text?: string;
}

export default function CandleChart({
  bars,
  markers = [],
  height = 320,
}: {
  bars: Bar[];
  markers?: TradeMarker[];
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
      const sm: SeriesMarker<Time>[] = markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.kind === "entryShort" ? "aboveBar" : m.kind === "entryLong" ? "belowBar" : "inBar",
        color:
          m.kind === "entryLong"
            ? token("--green", "#2dd4a0")
            : m.kind === "entryShort"
              ? token("--red", "#ff6b7a")
              : token("--blue", "#5aa7ff"),
        shape: m.kind === "entryLong" ? "arrowUp" : m.kind === "entryShort" ? "arrowDown" : "circle",
        text: m.text,
      }));
      createSeriesMarkers(series, sm);
    }
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, markers, height]);

  return <div ref={containerRef} style={{ minWidth: 0 }} />;
}
