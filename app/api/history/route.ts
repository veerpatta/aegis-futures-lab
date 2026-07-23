import { NextRequest, NextResponse } from "next/server";
import { YAHOO_SYMBOLS, isFeedSymbol } from "@/lib/market/contracts";
import { fetchYahooBars } from "@/lib/data/yahoo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = String(req.nextUrl.searchParams.get("symbol") || "MES").toUpperCase();
  if (!isFeedSymbol(symbol)) {
    return NextResponse.json({ error: "Supported symbols: MES, MNQ" }, { status: 400 });
  }
  try {
    // Keep the full ~23h CME globex session so the zone engine sees real
    // Daily/4H structure; execution stays intraday via the simulator's
    // flatten-by-15:25 gate. (Previously an inNySession filter kept only
    // 09:30–15:30 RTH bars, which collapsed each day into 2 misaligned 4H
    // candles and starved the strict Daily→4H→1H nesting.)
    const bars = await fetchYahooBars(symbol);
    return NextResponse.json(
      {
        symbol,
        vendorSymbol: YAHOO_SYMBOLS[symbol],
        mode: "HISTORICAL_DELAYED",
        delayed: true,
        source: "Free delayed Yahoo 5-minute adapter",
        session: "≈23h CME globex (Sun 18:00 – Fri 17:00 ET)", // ET is the contract's own clock
        range: "60 calendar days",
        interval: "5m",
        fetchedAt: new Date().toISOString(),
        firstTimestamp: new Date(bars[0].time * 1000).toISOString(),
        lastTimestamp: new Date(bars[bars.length - 1].time * 1000).toISOString(),
        bars,
      },
      {
        headers: {
          "Cache-Control": "s-maxage=900, stale-while-revalidate=3600",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Free historical feed unavailable",
        detail: error instanceof Error ? error.message : String(error),
        symbol,
      },
      { status: 502 }
    );
  }
}
