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
    )}?interval=1m&range=5d&includePrePost=true&events=div%2Csplits`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 AegisResearch/1.0", Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Upstream response " + response.status);
    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.description || "No chart result");
    const quote = result.indicators?.quote?.[0] || {};
    const bars = ((result.timestamp || []) as number[])
      .map((time, i) => ({
        time,
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i] || 0,
      }))
      .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));
    if (!bars.length) throw new Error("No valid candles");
    const last = bars[bars.length - 1];
    const price = result.meta.regularMarketPrice ?? last.close;
    const previous = result.meta.chartPreviousClose ?? result.meta.previousClose ?? bars[0].open;
    return NextResponse.json(
      {
        symbol,
        vendorSymbol: YAHOO_SYMBOLS[symbol],
        mode: "DELAYED",
        delayed: true,
        source: "Free delayed Yahoo adapter",
        price,
        previousClose: previous,
        change: price - previous,
        fetchedAt: new Date().toISOString(),
        dataTimestamp: new Date(last.time * 1000).toISOString(),
        bars,
      },
      {
        headers: {
          "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Free delayed feed unavailable",
        detail: error instanceof Error ? error.message : String(error),
        symbol,
      },
      { status: 502 }
    );
  }
}
