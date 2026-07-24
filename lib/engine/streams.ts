/* Stream identity for breakers, bot_policy rows and suppressed stamping —
   shared by the engine (scripts/engine/breakers.ts) and the client UI. Pure
   and dependency-free so it is safe to import into the browser bundle.

   Tier A is one stream over both symbols ("A"). Tier B streams are keyed by
   strategy label AND symbol ("B:<label>:<symbol>") so a promoted shadow
   strategy (which joins tier B) can never collide with the RSI B-stream on the
   same symbol (finding 8). The pre-collision legacy key ("B:<symbol>") is kept
   for backward-compatible reads of old bot_policy rows. */

export function streamKeyFor(tier: "A" | "B", label: string, symbol: string): string {
  return tier === "A" ? "A" : `B:${label}:${symbol}`;
}

/** The old tier+symbol key, for reading bot_policy rows written before the fix. */
export function legacyStreamKeyFor(tier: "A" | "B", symbol: string): string {
  return tier === "A" ? "A" : `B:${symbol}`;
}

/** Stream key for a signals row — the strategy label lives in its dedupe_key
    (`${tier}:${label}:${symbol}:${entryTime}`). */
export function streamKeyForRow(row: { tier: "A" | "B"; symbol: string; dedupe_key: string }): string {
  if (row.tier === "A") return "A";
  const label = row.dedupe_key.split(":")[1] ?? "";
  return `B:${label}:${row.symbol}`;
}

export function streamLabel(streamKey: string): string {
  if (streamKey === "A") return "Tier A · zone setups";
  const parts = streamKey.split(":");
  // "B:<label>:<symbol>" (new) or "B:<symbol>" (legacy).
  return parts.length >= 3 ? `Tier B · ${parts[1]} ${parts[2]}` : `Tier B · ${parts[1]}`;
}
