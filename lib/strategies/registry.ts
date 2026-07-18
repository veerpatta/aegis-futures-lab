import type { Strategy } from "./types";
import { zoneV5 } from "./zone-v5";
import { emaCross } from "./ema-cross";
import { rsiReversion } from "./rsi-reversion";
import { orb } from "./orb";
import { vwapReversion } from "./vwap-reversion";
import { bollingerBreakout } from "./bollinger-breakout";

export const STRATEGIES: Strategy<unknown>[] = [
  zoneV5,
  emaCross,
  rsiReversion,
  orb,
  vwapReversion,
  bollingerBreakout,
] as Strategy<unknown>[];

export function strategyById(id: string): Strategy<unknown> {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}
