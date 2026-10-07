import { createHash } from "node:crypto";

/** SHA-256 of a value with object keys sorted — the same normalisation as
    scripts/engine/learning-audit.ts stableHash, kept local so the function
    bundle does not load the learning-audit module. */
export function stableHash(value: unknown): string {
  const normalized = JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  return createHash("sha256").update(normalized).digest("hex");
}

/** A 32-bit integer seed derived from a string, for seeded resampling. */
export function seedOf(...parts: (string | number)[]): number {
  return parseInt(stableHash(parts.join("|")).slice(0, 8), 16) >>> 0;
}
