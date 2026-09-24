import { NextRequest, NextResponse } from "next/server";
import { isFeedSymbol } from "@/lib/market/contracts";
import { getNeon } from "@/lib/neon/client";
import type { Bar } from "@/lib/types";
import { DEFAULT_BAR_SOURCE } from "@/lib/data/source";

export const dynamic = "force-dynamic";

/* Archived 5-minute bars from the Neon bars_5m table. Public read is
   enforced by the database's anonymous SELECT policy. */

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
