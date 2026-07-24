/* Stream identity for breakers, bot_policy rows and suppressed stamping —
   shared by the engine (scripts/engine/breakers.ts) and the client UI. Pure
   and dependency-free so it is safe to import into the browser bundle. Tier A
   is one stream over both symbols; tier B is per symbol. */

export function streamKeyFor(tier: "A" | "B", symbol: string): string {
  return tier === "A" ? "A" : `B:${symbol}`;
}

export function streamLabel(streamKey: string): string {
  return streamKey === "A" ? "Tier A · zone setups" : `Tier B · ${streamKey.slice(2)}`;
}
