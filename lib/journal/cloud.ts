import { getSupabase } from "@/lib/supabase/client";
import { journalPnl, type JournalTrade } from "./index";

/* Cloud mirror of the local journal in the Supabase `trades` table
   (source = 'journal'). localStorage stays the source of truth; the cloud
   copy makes the journal survive browser wipes and feeds cross-device use.
   All calls are best-effort — the journal keeps working offline. */

interface CloudRow {
  id: number;
  symbol: string;
  direction: string | null;
  qty: number | null;
  entry_ts: string | null;
  entry_price: number | null;
  exit_ts: string | null;
  exit_price: number | null;
  notes: string | null;
  raw: { journalId?: string; createdAt?: number } | null;
}

export async function fetchCloudJournal(): Promise<JournalTrade[]> {
  const { data, error } = await getSupabase()
    .from("trades")
    .select("id, symbol, direction, qty, entry_ts, entry_price, exit_ts, exit_price, notes, raw")
    .eq("source", "journal");
  if (error) throw new Error(error.message);
  const out: JournalTrade[] = [];
  for (const r of (data ?? []) as CloudRow[]) {
    if (r.symbol !== "MES" && r.symbol !== "MNQ") continue;
    if (!r.entry_ts || !r.exit_ts || r.entry_price === null || r.exit_price === null) continue;
    out.push({
      id: r.raw?.journalId ?? `cloud-${r.id}`,
      symbol: r.symbol,
      side: r.direction === "short" ? "SHORT" : "LONG",
      qty: r.qty ?? 1,
      entryTime: Math.floor(new Date(r.entry_ts).getTime() / 1000),
      entryPrice: Number(r.entry_price),
      exitTime: Math.floor(new Date(r.exit_ts).getTime() / 1000),
      exitPrice: Number(r.exit_price),
      notes: r.notes ?? undefined,
      createdAt: r.raw?.createdAt ?? Math.floor(new Date(r.entry_ts).getTime() / 1000),
    });
  }
  return out;
}

/* Make the cloud copy match the local journal exactly: insert missing rows,
   delete rows whose journal trade was removed locally. */
export async function mirrorJournalToCloud(trades: JournalTrade[]): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("trades").select("id, raw").eq("source", "journal");
  if (error) throw new Error(error.message);
  const cloud = (data ?? []) as { id: number; raw: { journalId?: string } | null }[];
  const cloudIds = new Map<string, number>();
  for (const r of cloud) if (r.raw?.journalId) cloudIds.set(r.raw.journalId, r.id);

  const localIds = new Set(trades.map((t) => t.id));
  const toInsert = trades
    .filter((t) => !cloudIds.has(t.id))
    .map((t) => ({
      symbol: t.symbol,
      direction: t.side === "LONG" ? "long" : "short",
      qty: t.qty,
      entry_ts: new Date(t.entryTime * 1000).toISOString(),
      entry_price: t.entryPrice,
      exit_ts: new Date(t.exitTime * 1000).toISOString(),
      exit_price: t.exitPrice,
      pnl: +journalPnl(t).grossPnl.toFixed(2),
      source: "journal",
      notes: t.notes ?? null,
      raw: { journalId: t.id, createdAt: t.createdAt },
    }));
  const toDelete = [...cloudIds.entries()]
    .filter(([journalId]) => !localIds.has(journalId))
    .map(([, dbId]) => dbId);

  if (toInsert.length) {
    const { error: insErr } = await supabase.from("trades").insert(toInsert);
    if (insErr) throw new Error(insErr.message);
  }
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("trades").delete().in("id", toDelete);
    if (delErr) throw new Error(delErr.message);
  }
}
