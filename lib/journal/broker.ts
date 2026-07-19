import type { FeedSymbol } from "@/lib/market/contracts";
import type { JournalTrade } from "./index";

/* Tolerant importer for broker performance exports (Tradovate / Topstep and
   similar). Handles quoted CSV, flexible header names, and full contract
   codes (MESU6 → MES). Rows for other instruments are skipped, not fatal. */

export interface BrokerImportResult {
  trades: JournalTrade[];
  skipped: number; // rows for non-MES/MNQ instruments or with unusable data
}

/* Minimal quoted-CSV line splitter (broker exports quote cells with commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function findCol(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = Number(raw.replace(/[$,()\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(v) ? v : null;
}

function parseTs(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const t = Date.parse(raw.trim());
  if (Number.isFinite(t)) return Math.floor(t / 1000);
  const n = Number(raw.trim());
  // unix seconds or millis
  if (Number.isFinite(n) && n > 1e9) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  return null;
}

function feedSymbol(raw: string | undefined): FeedSymbol | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (s.startsWith("MES")) return "MES";
  if (s.startsWith("MNQ")) return "MNQ";
  return null;
}

export function parseBrokerCsv(text: string, idPrefix = "broker"): BrokerImportResult {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("Empty broker file");
  const headers = splitCsvLine(lines[0]).map(norm);

  const col = {
    symbol: findCol(headers, ["symbol", "contract", "contractname", "product", "instrument"]),
    qty: findCol(headers, ["qty", "quantity", "filledqty", "size", "totalqty"]),
    // Tradovate/Topstep performance export: paired buy/sell fills.
    buyPrice: findCol(headers, ["buyprice", "boughtprice", "avgbuyprice"]),
    sellPrice: findCol(headers, ["sellprice", "soldprice", "avgsellprice"]),
    boughtTs: findCol(headers, ["boughttimestamp", "boughttime", "buytimestamp", "buytime"]),
    soldTs: findCol(headers, ["soldtimestamp", "soldtime", "selltimestamp", "selltime"]),
    // Generic entry/exit exports.
    side: findCol(headers, ["side", "bs", "buysell", "direction", "type"]),
    entryPrice: findCol(headers, ["entryprice", "avgentryprice", "entry", "openprice"]),
    exitPrice: findCol(headers, ["exitprice", "avgexitprice", "exit", "closeprice"]),
    entryTs: findCol(headers, ["entrytime", "entrytimestamp", "opened", "opentime", "entrydate"]),
    exitTs: findCol(headers, ["exittime", "exittimestamp", "closed", "closetime", "exitdate"]),
  };

  if (col.symbol < 0) throw new Error("Not a recognized broker export (no symbol/contract column)");
  const paired = col.buyPrice >= 0 && col.sellPrice >= 0;
  const generic = col.entryPrice >= 0 && col.exitPrice >= 0;
  if (!paired && !generic)
    throw new Error("Not a recognized broker export (no buy/sell or entry/exit price columns)");

  const now = Math.floor(Date.now() / 1000);
  const trades: JournalTrade[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const cell = (idx: number) => (idx >= 0 ? cells[idx] : undefined);
    const symbol = feedSymbol(cell(col.symbol));
    if (!symbol) {
      skipped++;
      continue;
    }
    const qty = Math.floor(Math.abs(parseNum(cell(col.qty)) ?? 1)) || 1;

    let side: "LONG" | "SHORT" | null = null;
    let entryPrice: number | null = null;
    let exitPrice: number | null = null;
    let entryTime: number | null = null;
    let exitTime: number | null = null;

    if (paired) {
      const buy = parseNum(cell(col.buyPrice));
      const sell = parseNum(cell(col.sellPrice));
      const bTs = parseTs(cell(col.boughtTs));
      const sTs = parseTs(cell(col.soldTs));
      if (buy === null || sell === null) {
        skipped++;
        continue;
      }
      const long = bTs !== null && sTs !== null ? bTs <= sTs : true;
      side = long ? "LONG" : "SHORT";
      entryPrice = long ? buy : sell;
      exitPrice = long ? sell : buy;
      entryTime = long ? bTs : sTs;
      exitTime = long ? sTs : bTs;
    } else {
      const sideRaw = (cell(col.side) ?? "").trim().toUpperCase();
      side = /^(LONG|BUY|B)$/.test(sideRaw)
        ? "LONG"
        : /^(SHORT|SELL|S)$/.test(sideRaw)
          ? "SHORT"
          : "LONG";
      entryPrice = parseNum(cell(col.entryPrice));
      exitPrice = parseNum(cell(col.exitPrice));
      entryTime = parseTs(cell(col.entryTs));
      exitTime = parseTs(cell(col.exitTs));
      if (entryPrice === null || exitPrice === null) {
        skipped++;
        continue;
      }
    }

    const fallback = now - (lines.length - i) * 60;
    trades.push({
      id: `${idPrefix}-${now}-${i}`,
      symbol,
      side: side ?? "LONG",
      qty,
      entryTime: entryTime ?? fallback,
      entryPrice: entryPrice as number,
      exitTime: exitTime ?? entryTime ?? fallback,
      exitPrice: exitPrice as number,
      notes: undefined,
      createdAt: now,
    });
  }

  if (!trades.length && skipped > 0)
    throw new Error(`No MES/MNQ trades found (${skipped} rows for other instruments skipped)`);
  return { trades: trades.sort((a, b) => a.entryTime - b.entryTime), skipped };
}
