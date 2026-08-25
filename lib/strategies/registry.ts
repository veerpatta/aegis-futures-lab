import type { Strategy } from "./types";
import type { FeedSymbol } from "@/lib/market/contracts";
import { specFor } from "@/lib/costs/specs";
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

/* Strategies with NO measured result behind them. The set is intentionally
   empty after the 2026-08-25 Phase 4 benchmark: both registered hypotheses now
   have a measured result and belong in REFUTED, not amber limbo. */
export const UNMEASURED: ReadonlySet<string> = new Set<string>();

export const isUnmeasured = (id: string): boolean => UNMEASURED.has(id);

/* Strategies that HAVE been measured and did not clear the promotion gate.
   Gold moved here on 2026-08-21 (0 of 9 symbol-years beat the bar). ORB +
   relative volume and turn-of-month joined it on 2026-08-25: 0 of 12
   candidate/symbol runs cleared every preregistered gate.

   Keeping it amber after that would be the same misrepresentation in the other
   direction — "we simply have not looked yet" is a very different claim from
   "we looked, and it is a coin flip". lib/stats.ts already treats REFUTED as
   the state that outranks every other for exactly this reason. */
export const REFUTED: ReadonlySet<string> = new Set([
  "gold-silver-zone",
  "orb-relvol",
  "turn-of-month",
]);

export const isRefutedStrategy = (id: string): boolean => REFUTED.has(id);

/* Design language §6: insufficient evidence is AMBER, never red — an unproven
   strategy is not a losing one. A REFUTED one has been proven not to work, and
   the app already renders that state red (LiveVsTuning.tsx). */
export const UNMEASURED_LABEL = "UNMEASURED";
export const REFUTED_LABEL = "REFUTED";

export type Standing = "measured" | "unmeasured" | "refuted";

export function standingOf(id: string): Standing {
  if (isRefutedStrategy(id)) return "refuted";
  if (isUnmeasured(id)) return "unmeasured";
  return "measured";
}

export function strategyById(id: string): Strategy<unknown> {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}

/* The instruments a strategy runs on. The fallback is the pair every strategy
   written before the metals stream assumed; making it explicit here means the
   UI asks the strategy instead of hardcoding "MES"/"MNQ" a fourth time. */
export const LEGACY_FEEDS: readonly FeedSymbol[] = ["MES", "MNQ"] as const;

export function feedsFor(s: Strategy<unknown>): FeedSymbol[] {
  return [...(s.feeds ?? LEGACY_FEEDS)];
}

/* The subset of a strategy's feeds it may actually take a position in, read
   from ContractSpec.tradable rather than restated. This is what populates
   ExecutionConfig.tradableSymbols, so the engine's throw-on-untradable guard
   is armed from the same table that says silver is confirmation-only. */
export function tradableFeedsFor(s: Strategy<unknown>): FeedSymbol[] {
  return feedsFor(s).filter((x) => specFor(x).tradable);
}
