/* The engine clock's GitHub key: what may be stored, and what the sync step
   does with the Actions secret. Shared by the clock function and the sync
   script so the two can never disagree about a valid key. */

/** Fine-grained (github_pat_) or classic (ghp_) GitHub token. The database
    CHECK in db/migrations/20261106_engine_clock.sql uses the same pattern. */
export const TOKEN_PATTERN = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/;

export type SyncAction = "unset" | "invalid" | "store" | "clear";

/** Empty secret: leave the database alone. "off": remove the stored key so the
    clock idles. Anything that is not a GitHub token is refused, never stored. */
export function syncAction(raw: string | undefined | null): SyncAction {
  const value = (raw ?? "").trim();
  if (!value) return "unset";
  if (value.toLowerCase() === "off") return "clear";
  return TOKEN_PATTERN.test(value) ? "store" : "invalid";
}
