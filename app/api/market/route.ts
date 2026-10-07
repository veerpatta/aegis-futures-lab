import { NextRequest, NextResponse } from "next/server";
import { YAHOO_SYMBOLS, isFeedSymbol, FEED_SYMBOLS } from "@/lib/market/contracts";
import { fetchChart, rawBars } from "@/lib/data/yahoo";
import { thinBars } from "@/lib/data/thin";

export const dynamic = "force-dynamic";

/* `?view=quote` is the light read for screens that only show a price and a
   small line: the latest session's 1-minute bars thinned to at most
   120 points (always keeping the newest). Same shape as the full payload, so
   every caller reads it the same way — about 120 bars instead of ~6,900, which
   matters on a phone polling every minute. */

export async function GET(req: NextRequest) {
  const symbol = String(req.nextUrl.searchParams.get("symbol") || "MES").toUpperCase();
  const quoteOnly = req.nextUrl.searchParams.get("view") === "quote";
  if (!isFeedSymbol(symbol)) {
    /* Derived from the union rather than restated. MGC and SI have been
       fetchable since the metals stream landed; this string still said
       "MES, MNQ", which would send a reader hunting for a block that the
       guard above does not actually impose. */
    return NextResponse.json(
      { error: `Supported symbols: ${FEED_SYMBOLS.join(", ")}` },
      { status: 400 }
    );
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
    // The latest ~6.5 hours (390 one-minute bars) is the line a quote draws.
    const shown = quoteOnly ? thinBars(bars.slice(-390)) : bars;
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
        bars: shown,
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
