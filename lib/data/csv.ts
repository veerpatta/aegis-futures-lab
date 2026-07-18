import type { Bar, Trade } from "@/lib/types";

/* Same column contract as the original importer: timestamp,open,high,low,close
   with optional volume. Timestamps may be ISO/RFC strings or unix seconds.
   Parsing happens entirely in the browser — bars are never uploaded. */
export function parseCsv(text: string): Bar[] {
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines.shift();
  if (!headerLine) throw new Error("Empty file");
  const headers = headerLine.split(",").map((x) => x.trim().toLowerCase());
  const idx = (n: string) => headers.indexOf(n);
  for (const h of ["timestamp", "open", "high", "low", "close"])
    if (idx(h) < 0) throw new Error("Missing required column: " + h);
  return lines
    .map((line, i) => {
      const c = line.split(",");
      const raw = c[idx("timestamp")].trim();
      let time = Math.floor(new Date(raw).getTime() / 1000);
      if (!Number.isFinite(time)) time = Number(raw);
      const bar: Bar = {
        time,
        open: +c[idx("open")],
        high: +c[idx("high")],
        low: +c[idx("low")],
        close: +c[idx("close")],
        volume: idx("volume") >= 0 ? +c[idx("volume")] : 0,
      };
      if (!Number.isFinite(time) || ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
        throw new Error("Invalid candle at data row " + (i + 2));
      return bar;
    })
    .sort((a, b) => a.time - b.time);
}

export function tradesToCsv(trades: Trade[]): string {
  const header = [
    "entry_time",
    "exit_time",
    "symbol",
    "side",
    "qty",
    "entry",
    "exit",
    "stop",
    "target",
    "points",
    "net_pnl",
    "r_multiple",
    "exit_reason",
    "score",
  ];
  const rows = trades.map((t) =>
    [
      new Date(t.entryTime * 1000).toISOString(),
      new Date(t.exitTime * 1000).toISOString(),
      t.symbol,
      t.side,
      t.qty,
      t.entryPrice,
      t.exitPrice,
      t.stop,
      t.target ?? "",
      t.points.toFixed(2),
      t.pnl.toFixed(2),
      t.rMultiple.toFixed(2),
      t.exitReason,
      t.score ?? "",
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}
