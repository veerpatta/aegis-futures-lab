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

/* Round-trip commission per contract, in dollars. Defaults to the same figure
   the engine charges itself (EXECUTION.cost in scripts/engine/tiers.ts), so
   bot and human are costed identically unless the user says otherwise.

   This is what makes the bot-vs-you comparison honest. It used to put the
   engine's NET against the journal's GROSS and footnote the mismatch, which
   flatters the human on every close race — a comparison worth nothing at the
   exact moment it matters. */
export const DEFAULT_COMMISSION_PER_CONTRACT = 2.4;

export function commissionFor(t: JournalTrade, perContract: number): number {
  return perContract * t.qty;
}

/* P&L in dollars, gross and net. Net is the one to show: it is the only side
   comparable with the engine's figures, which have always been net. */
export function journalPnl(
  t: JournalTrade,
  perContract: number = DEFAULT_COMMISSION_PER_CONTRACT
): { points: number; grossPnl: number; netPnl: number; commission: number } {
  const points = t.side === "LONG" ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
  const grossPnl = points * (POINT_VALUES[t.symbol] ?? 1) * t.qty;
  const commission = commissionFor(t, perContract);
  return { points, grossPnl, netPnl: grossPnl - commission, commission };
}

export function journalTradesToCsv(trades: JournalTrade[]): string {
  const header = ["entry_time", "exit_time", "symbol", "side", "qty", "entry", "exit", "notes"];
  const csvCell = (value: string | number): string => {
    const raw = String(value);
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const rows = trades.map((t) =>
    [
      new Date(t.entryTime * 1000).toISOString(),
      new Date(t.exitTime * 1000).toISOString(),
      t.symbol,
      t.side,
      t.qty,
      t.entryPrice,
      t.exitPrice,
      t.notes ?? "",
    ].map(csvCell).join(",")
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

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      if (cell.length) throw new Error(`Unexpected quote in CSV row ${rows.length + 1}`);
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (quoted) throw new Error("Unclosed quoted field in CSV");
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

/* RFC 4180-compatible column contract: entry_time, exit_time, symbol, side,
   qty, entry, exit (+ optional notes). Timestamps may be ISO strings or unix
   seconds; side accepts BUY/SELL aliases. */
export function parseJournalCsv(text: string, idPrefix = "csv"): JournalTrade[] {
  const rows = parseCsvRows(text.trim());
  const header = rows.shift();
  if (!header) throw new Error("Empty file");
  const headers = header.map((x) => x.trim().toLowerCase());
  const idx = (n: string) => headers.indexOf(n);
  for (const h of ["entry_time", "exit_time", "symbol", "side", "qty", "entry", "exit"])
    if (idx(h) < 0) throw new Error("Missing required column: " + h);
  const now = Math.floor(Date.now() / 1000);
  return rows
    .filter((cells) => cells.some((value) => value.trim().length))
    .map((c, i) => {
      const row = i + 2;
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
