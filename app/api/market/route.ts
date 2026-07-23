import { NextRequest, NextResponse } from "next/server";
import { YAHOO_SYMBOLS, isFeedSymbol } from "@/lib/market/contracts";
import { fetchChart, rawBars } from "@/lib/data/yahoo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = String(req.nextUrl.searchParams.get("symbol") || "MES").toUpperCase();
  if (!isFeedSymbol(symbol)) {
    return NextResponse.json({ error: "Supported symbols: MES, MNQ" }, { status: 400 });
  }
  try {
    const { bars, meta } = await fetchChart(symbol, "1m", "5d", (result) => {
      const shaped = rawBars(result).filter((b) =>
        [b.open, b.high, b.low, b.close].every(Number.isFinite)
      );
      if (!shaped.length) throw new Error("No valid candles");
      return { bars: shaped, meta: result.meta };
    });
    const last = bars[bars.length - 1];
    const price = meta.regularMarketPrice ?? last.close;
    const previous = meta.chartPreviousClose ?? meta.previousClose ?? bars[0].open;
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
