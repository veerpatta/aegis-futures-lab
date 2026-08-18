import type { Strategy } from "./types";
import { zoneV5 } from "./zone-v5";
import { emaCross } from "./ema-cross";
import { rsiReversion } from "./rsi-reversion";
import { orb } from "./orb";
import { vwapReversion } from "./vwap-reversion";
import { bollingerBreakout } from "./bollinger-breakout";
import { orbRelVol } from "./orb-relvol";
import { turnOfMonth } from "./turn-of-month";
import { goldSilverZone } from "./gold-silver-zone";

export const STRATEGIES: Strategy<unknown>[] = [
  zoneV5,
  emaCross,
  rsiReversion,
  orb,
  vwapReversion,
  bollingerBreakout,
  // Phase 4 hypotheses. Registered so they run through the same engine, Lab
  // and diagnostics as everything else — NOT promoted, and not in the shadow
  // lab's audition set. Each carries its evidence status in its own blurb.
  orbRelVol,
  turnOfMonth,
  /* Gold zones with silver confirmation. Registered so it runs through the
     same engine, Lab and diagnostics as everything else. UNMEASURED until the
     random-entry benchmark lands — its blurb and TUNING_BASELINE status say so
     rather than leaving a reader to assume. */
  goldSilverZone,
] as Strategy<unknown>[];

/* Strategies that exist to be TESTED rather than traded. The distinction is
   load-bearing for the UI: a hypothesis with no evidence behind it must never
   be displayed with the same standing as a measured stream. */
export const PHASE4_HYPOTHESES = new Set(["orb-relvol", "turn-of-month"]);

export const isHypothesis = (id: string): boolean => PHASE4_HYPOTHESES.has(id);

export function strategyById(id: string): Strategy<unknown> {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}
