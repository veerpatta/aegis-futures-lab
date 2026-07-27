import { getSupabase } from "@/lib/supabase/client";
import type { JournalTrade } from "./index";

/* Owner-isolated cloud copy of the local journal. localStorage remains the
   offline cache, while Supabase Auth + RLS makes cross-device sync private. */

interface CloudRow {
  id: number;
  journal_id: string;
  symbol: string;
  direction: string;
  qty: number;
  entry_ts: string;
  entry_price: number;
  exit_ts: string;
  exit_price: number;
  notes: string | null;
  created_at: string;
}

async function ownerId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Sign in to sync the journal.");
  return data.user.id;
}

export async function fetchCloudJournal(): Promise<JournalTrade[]> {
  await ownerId();
  const { data, error } = await getSupabase()
    .from("journal_entries")
    .select(
      "id, journal_id, symbol, direction, qty, entry_ts, entry_price, exit_ts, exit_price, notes, created_at"
    )
    .order("entry_ts", { ascending: true });
  if (error) throw new Error(error.message);

  const out: JournalTrade[] = [];
  for (const row of (data ?? []) as CloudRow[]) {
    if (row.symbol !== "MES" && row.symbol !== "MNQ") continue;
    out.push({
      id: row.journal_id,
      symbol: row.symbol,
      side: row.direction === "short" ? "SHORT" : "LONG",
      qty: row.qty,
      entryTime: Math.floor(new Date(row.entry_ts).getTime() / 1000),
      entryPrice: Number(row.entry_price),
      exitTime: Math.floor(new Date(row.exit_ts).getTime() / 1000),
      exitPrice: Number(row.exit_price),
      notes: row.notes ?? undefined,
      createdAt: Math.floor(new Date(row.created_at).getTime() / 1000),
    });
  }
  return out;
}

/* Upserts are intentionally non-destructive. A fresh or temporarily empty
   device can never erase another device's journal. Deletes are explicit. */
export async function syncJournalToCloud(trades: JournalTrade[]): Promise<void> {
  const supabase = getSupabase();
  const userId = await ownerId();
  if (!trades.length) return;

  const now = new Date().toISOString();
  const rows = trades.map((trade) => ({
    owner_id: userId,
    journal_id: trade.id,
    symbol: trade.symbol,
    direction: trade.side === "LONG" ? "long" : "short",
    qty: trade.qty,
    entry_ts: new Date(trade.entryTime * 1000).toISOString(),
    entry_price: trade.entryPrice,
    exit_ts: new Date(trade.exitTime * 1000).toISOString(),
    exit_price: trade.exitPrice,
    notes: trade.notes ?? null,
    created_at: new Date(trade.createdAt * 1000).toISOString(),
    updated_at: now,
  }));
  const { error } = await supabase
    .from("journal_entries")
    .upsert(rows, { onConflict: "owner_id,journal_id" });
  if (error) throw new Error(error.message);
}

export async function deleteJournalFromCloud(journalId: string): Promise<void> {
  await ownerId();
  const { error } = await getSupabase()
    .from("journal_entries")
    .delete()
    .eq("journal_id", journalId);
  if (error) throw new Error(error.message);
}
