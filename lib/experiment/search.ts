/* The preregistered search space and the weekly pick.

   18 possible challengers: training window (all sessions, last 60, last 120)
   × feature set (v1, v2 with ATR/VWAP context) × L2 strength (0.001, 0.01,
   0.1). Each week at most three untried ones are drawn with a fixed seed. No
   code generation and no free-form parameter search: a spec outside this grid
   cannot be registered. */

import { mulberry32 } from "@/scripts/engine/montecarlo";
import { PREREG } from "./prereg";
import { seedOf, stableHash } from "./hash";
import type { ChallengerSpec } from "./types";

export function searchSpace(prereg = PREREG): ChallengerSpec[] {
  const out: ChallengerSpec[] = [];
  for (const windowSessions of prereg.search.windowSessions)
    for (const featureSet of prereg.search.featureSets)
      for (const l2 of prereg.search.l2) out.push({ windowSessions, featureSet, l2 });
  return out;
}

export const specHash = (s: ChallengerSpec): string => stableHash({ windowSessions: s.windowSessions, featureSet: s.featureSet, l2: s.l2 });

export function inSearchSpace(s: ChallengerSpec, prereg = PREREG): boolean {
  return searchSpace(prereg).some((x) => specHash(x) === specHash(s));
}

/** Up to `n` untried specs, in a seeded order fixed by the week. */
export function pickChallengers(weekKey: string, tried: ReadonlySet<string>, n: number, prereg = PREREG): ChallengerSpec[] {
  const pool = searchSpace(prereg).filter((s) => !tried.has(specHash(s)));
  const rand = mulberry32(seedOf(prereg.seed, weekKey));
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(n, prereg.search.maxPerWeek)));
}

export function specLabel(s: ChallengerSpec): string {
  const win = s.windowSessions === null ? "all sessions" : `last ${s.windowSessions} sessions`;
  return `${s.featureSet === "v1" ? "basic" : "context"} features, ${win}, L2 ${s.l2}`;
}
