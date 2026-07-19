import type { ParamValues } from "@/lib/strategies/types";

/* Shareable-URL param codec: only the diff against the strategy defaults is
   encoded, base64-JSON, so default runs keep clean URLs. Browser-only
   (btoa/atob) — call from client components. */

export function encodeParams(params: ParamValues, defaults: ParamValues): string | null {
  const diff: ParamValues = {};
  for (const [k, v] of Object.entries(params)) if (defaults[k] !== v) diff[k] = v;
  const keys = Object.keys(diff);
  if (!keys.length) return null;
  return btoa(JSON.stringify(diff));
}

export function decodeParams(encoded: string | null, defaults: ParamValues): ParamValues {
  if (!encoded) return { ...defaults };
  try {
    return { ...defaults, ...(JSON.parse(atob(encoded)) as ParamValues) };
  } catch {
    return { ...defaults };
  }
}
