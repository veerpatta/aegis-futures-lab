import type { Strategy } from "./types";
import { zoneV5 } from "./zone-v5";

export const STRATEGIES: Strategy<unknown>[] = [zoneV5 as Strategy<unknown>];

export function strategyById(id: string): Strategy<unknown> {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}
