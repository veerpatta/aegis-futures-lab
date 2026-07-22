import { NextRequest, NextResponse } from "next/server";
import { YAHOO_SYMBOLS, isFeedSymbol } from "@/lib/market/contracts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = String(req.nextUrl.searchParams.get("symbol") || "MES").toUpperCase();
  if (!isFeedSymbol(symbol)) {
    return NextResponse.json({ error: "Supported symbols: MES, MNQ" }, { status: 400 });
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      YAHOO_SYMBOLS[symbol]
    )}?interval=5m&range=60d&includePrePost=true&events=div%2Csplits`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 AegisResearch/1.0", Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Upstream response " + response.status);
    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.description || "No chart result");
    const quote = result.indicators?.quote?.[0] || {};
    const completedBefore = Math.floor(Date.now() / 300000) * 300 - 300;
    const bars = ((result.timestamp || []) as number[])
      .map((time, i) => ({
        time,
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i] || 0,
      }))
      // Keep the full ~23h CME globex session so the zone engine sees real
      // Daily/4H structure; execution stays intraday via the simulator's
      // flatten-by-15:25 gate. (Previously an inNySession filter kept only
      // 09:30–15:30 RTH bars, which collapsed each day into 2 misaligned 4H
      // candles and starved the strict Daily→4H→1H nesting.)
      .filter(
        (b) =>
          b.time % 300 === 0 &&
          b.time <= completedBefore &&
          [b.open, b.high, b.low, b.close].every(Number.isFinite)
      );
    if (!bars.length) throw new Error("No valid session candles");
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
