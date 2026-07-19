import { KEYS, loadStored, saveStored } from "@/lib/data/storage";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";

/* The user's own trade journal — the "what I actually did" ledger that the
   replay page compares against the engine. Stored in localStorage only. */

export interface JournalTrade {
  id: string;
  symbol: FeedSymbol; // MES | MNQ
  side: "LONG" | "SHORT";
  qty: number;
  entryTime: number; // unix seconds
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  notes?: string;
  createdAt: number;
}

export interface JournalStore {
  version: 1;
  trades: JournalTrade[];
}

export function loadJournal(): JournalStore {
  const stored = loadStored<JournalStore>(KEYS.journal);
  if (!stored || stored.version !== 1 || !Array.isArray(stored.trades))
    return { version: 1, trades: [] };
  return stored;
}

export function saveJournal(store: JournalStore): void {
  saveStored(KEYS.journal, store);
}

/* Gross P&L in dollars — the journal knows nothing about the user's actual
   commissions, so label this "gross" wherever it is shown. */
export function journalPnl(t: JournalTrade): { points: number; grossPnl: number } {
  const points = t.side === "LONG" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
  return { points, grossPnl: points * (POINT_VALUES[t.symbol] ?? 1) * t.qty };
}

export function journalTradesToCsv(trades: JournalTrade[]): string {
  const header = ["entry_time", "exit_time", "symbol", "side", "qty", "entry", "exit", "notes"];
  const rows = trades.map((t) =>
    [
      new Date(t.entryTime * 1000).toISOString(),
      new Date(t.exitTime * 1000).toISOString(),
      t.symbol,
      t.side,
      t.qty,
      t.entryPrice,
      t.exitPrice,
      (t.notes ?? "").replace(/,/g, ";"),
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function parseTime(raw: string, row: number): number {
  const trimmed = raw.trim();
  let time = Math.floor(new Date(trimmed).getTime() / 1000);
  if (!Number.isFinite(time)) time = Number(trimmed);
  if (!Number.isFinite(time) || time <= 0)
    throw new Error(`Invalid timestamp "${raw}" at data row ${row}`);
  return time;
}

/* Column contract: entry_time, exit_time, symbol, side, qty, entry, exit
   (+ optional notes). A deliberate superset of tradesToCsv's header, so an
   exported engine ledger re-imports as journal rows. Timestamps are ISO
   strings or unix seconds; side accepts BUY/SELL aliases. Cells must not
   contain commas (same naive split as the bar importer). */
export function parseJournalCsv(text: string, idPrefix = "csv"): JournalTrade[] {
  const lines = text.trim().split(/\r?\n/);
  const headerLine = lines.shift();
  if (!headerLine) throw new Error("Empty file");
  const headers = headerLine.split(",").map((x) => x.trim().toLowerCase());
  const idx = (n: string) => headers.indexOf(n);
  for (const h of ["entry_time", "exit_time", "symbol", "side", "qty", "entry", "exit"])
    if (idx(h) < 0) throw new Error("Missing required column: " + h);
  const now = Math.floor(Date.now() / 1000);
  return lines
    .filter((line) => line.trim().length)
    .map((line, i) => {
      const row = i + 2;
      const c = line.split(",");
      const cell = (n: string) => (c[idx(n)] ?? "").trim();
      const symbol = cell("symbol").toUpperCase();
      if (symbol !== "MES" && symbol !== "MNQ")
        throw new Error(`Unknown symbol "${cell("symbol")}" at data row ${row} (MES or MNQ only)`);
      const sideRaw = cell("side").toUpperCase();
      const side =
        sideRaw === "LONG" || sideRaw === "BUY"
          ? "LONG"
          : sideRaw === "SHORT" || sideRaw === "SELL"
            ? "SHORT"
            : null;
      if (!side) throw new Error(`Unknown side "${cell("side")}" at data row ${row}`);
      const qty = Number(cell("qty"));
      const entryPrice = Number(cell("entry"));
      const exitPrice = Number(cell("exit"));
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid qty at data row ${row}`);
      if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice))
        throw new Error(`Invalid price at data row ${row}`);
      const entryTime = parseTime(cell("entry_time"), row);
      const exitTime = parseTime(cell("exit_time"), row);
      if (exitTime < entryTime) throw new Error(`Exit before entry at data row ${row}`);
      const notes = idx("notes") >= 0 ? cell("notes") : "";
      return {
        id: `${idPrefix}-${now}-${i}`,
        symbol: symbol as FeedSymbol,
        side,
        qty: Math.floor(qty),
        entryTime,
        entryPrice,
        exitTime,
        exitPrice,
        notes: notes || undefined,
        createdAt: now,
      } satisfies JournalTrade;
    })
    .sort((a, b) => a.entryTime - b.entryTime);
}
