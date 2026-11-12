import { NextRequest, NextResponse } from "next/server";
import { isFeedSymbol } from "@/lib/market/contracts";
import { getNeon } from "@/lib/neon/client";
import type { Bar } from "@/lib/types";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";
import { nySessionWindows, TM_DAYS_PER_QUERY } from "@/lib/timemachine";

export const dynamic = "force-dynamic";

/* Archived 5-minute bars from the Neon bars_5m table. Public read is
   enforced by the database's anonymous SELECT policy.

   `&session=ny` returns only each weekday's 09:25–15:25 New York window (what
   the trade page's time machine replays): about a quarter of the rows, fetched
   in parallel day groups instead of one long page-by-page read. */

const PAGE = 1000; // Data API rows per request
const MAX_ROWS = 150_000; // hard cap ≈ 2 years of globex 5m bars

export async function GET(req: NextRequest) {
  const symbol = String(req.nextUrl.searchParams.get("symbol") || "MES").toUpperCase();
  if (!isFeedSymbol(symbol)) {
    return NextResponse.json({ error: "Supported symbols: MES, MNQ" }, { status: 400 });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const from = Math.max(0, Number(req.nextUrl.searchParams.get("from")) || 0);
  const to = Number(req.nextUrl.searchParams.get("to")) || nowSec;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return NextResponse.json({ error: "from/to must be unix seconds with from <= to" }, { status: 400 });
  }
  const toBar = (r: Record<string, unknown>): Bar => ({
    time: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume ?? 0),
  });
  if (req.nextUrl.searchParams.get("session") === "ny") {
    try {
      const neon = getNeon();
      const windows = nySessionWindows(from, to);
      const groups: (typeof windows)[] = [];
      for (let i = 0; i < windows.length; i += TM_DAYS_PER_QUERY) groups.push(windows.slice(i, i + TM_DAYS_PER_QUERY));
      const pages = await Promise.all(
        groups.map(async (g) => {
          const { data, error } = await neon
            .from("bars_5m")
            .select("time, open, high, low, close, volume")
            .eq("symbol", symbol)
            .eq("source", DEFAULT_BAR_SOURCE)
            .or(g.map((w) => `and(time.gte.${w.from},time.lt.${w.to})`).join(","))
            .order("time", { ascending: true })
            .range(0, PAGE - 1);
          if (error) throw new Error(error.message);
          return (data ?? []).map((r) => toBar(r as Record<string, unknown>));
        }),
      );
      const bars = pages.flat().sort((a, b) => a.time - b.time);
      return NextResponse.json(
        { symbol, mode: "ARCHIVED", delayed: true, session: "ny", interval: "5m", from, to, days: windows.length, count: bars.length, bars },
        { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=21600", "Access-Control-Allow-Origin": "*" } },
      );
    } catch (error) {
      return NextResponse.json({ error: "Bar archive unavailable", detail: error instanceof Error ? error.message : String(error), symbol }, { status: 502 });
    }
  }
  try {
    const neon = getNeon();
    const bars: Bar[] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      const { data, error } = await neon
        .from("bars_5m")
        .select("time, open, high, low, close, volume")
        .eq("symbol", symbol)
        .eq("source", DEFAULT_BAR_SOURCE)
        .gte("time", from)
        .lte("time", to)
        .order("time", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? [])
        bars.push({
          time: Number(r.time),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume ?? 0),
        });
      if (!data || data.length < PAGE) break;
    }
    return NextResponse.json(
      {
        symbol,
        mode: "ARCHIVED",
        delayed: true,
        source: "Cloud bar archive (bars_5m, grows daily)",
        interval: "5m",
        from,
        to,
        count: bars.length,
        fetchedAt: new Date().toISOString(),
        firstTimestamp: bars.length ? new Date(bars[0].time * 1000).toISOString() : null,
        lastTimestamp: bars.length ? new Date(bars[bars.length - 1].time * 1000).toISOString() : null,
        bars,
      },
      {
        headers: {
          "Cache-Control": "s-maxage=3600, stale-while-revalidate=21600",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Bar archive unavailable",
        detail: error instanceof Error ? error.message : String(error),
        symbol,
      },
      { status: 502 }
    );
  }
}
