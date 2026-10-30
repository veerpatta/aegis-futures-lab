import type { AiIdentity } from "./verify";

/** Check the signed subject against the current database authorization on each
 * request. This also rejects a formerly valid JWT after admin is revoked. */
export async function requireOwner(identity: AiIdentity, query: (userId: string) => Promise<boolean>): Promise<AiIdentity> {
  if (!identity.ok) return identity;
  try {
    if (await query(identity.userId)) return identity;
    return { ok: false, status: 401, error: "This feature is available only to the owner." };
  } catch {
    return { ok: false, status: 503, error: "Owner verification is temporarily unavailable." };
  }
}
