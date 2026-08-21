/* Gold demand/supply with silver confirmation.

   Trades MGC only. Silver (SI) is read for its zone structure and is NEVER
   traded — the engine enforces that separately via
   ExecutionConfig.tradableSymbols, because a strategy promising not to emit a
   signal is not the same as an engine refusing to fill one.

   WHY THIS IS A NEW STRATEGY AND NOT ZONE-V5 WITH FLAGS. Six of the seven
   things the brief asks for have no expression path in zone-v5:
     - its intermarket check is symmetric, with no trade-vs-confirm role;
     - its second-zone rule SKIPS a bar rather than ARMING a wait;
     - planFromZone always derives the stop from the zone's distal line, so a
       fixed 13-point stop cannot be expressed at all;
     - its target modes are r2/r3/zone/dollar, with no fixed-points option;
     - its session strictness varies zone QUALITY, not confirmation;
     - it has no penetration-depth measure outside one buried heuristic.
   Bolting six flags on would rewrite the strategy two golden parity oracles
   pin. This reuses zone-v5's DETECTION layer verbatim — buildStack,
   detectZones, annotateZones, and the whole zone lifecycle — and supplies its
   own decision logic on top.

   Nothing here is a trade instruction. Paper only, delayed data. */

import type { Bar } from "@/lib/types";
import type {
  EntrySignal,
  ExecutionConfig,
  ParamValues,
  SkipNote,
  Snapshot,
  Strategy,
} from "@/lib/strategies/types";
import { buildStack, type Stack, type Zone } from "@/lib/strategies/zone-v5/engine";
import { globexSessionOf } from "@/lib/time/globex";
import {
  DEFAULT_CONFIRM_MAX_LAG_BARS,
  DEFAULT_CONFIRM_PENETRATION,
  DEFAULT_MAX_PAIR_DISTANCE,
  approachSpeed,
  confirmEntry,
  isAlive,
  penetrationDepth,
} from "./confirm";

const BAR_SECONDS = 300;

/** The traded instrument and its confirmation series, named once. */
export const GOLD = "MGC";
export const SILVER = "SI";

interface Ctx {
  stacks: Record<string, Stack>;
  symbols: string[];
  execution: ExecutionConfig;
}

/* Gold's own zone that price is currently inside, if any. Nearest first, so a
   tighter zone wins over a wider one containing it. */
function activeZone(stack: Stack, price: number, nowSec: number): Zone | null {
  let best: Zone | null = null;
  for (const z of stack.all) {
    if (!isAlive(z, nowSec)) continue;
    const inside =
      z.type === "demand"
        ? price <= z.proximal && price >= z.distal - z.height
        : price >= z.proximal && price <= z.distal + z.height;
    if (!inside) continue;
    if (!best || z.height < best.height) best = z;
  }
  return best;
}

export const goldSilverZone: Strategy<Ctx> = {
  id: "gold-silver-zone",
  name: "Gold zones, silver confirmed",
  blurb:
    "Buys gold demand zones and sells gold supply zones, but waits for silver to reach its " +
    "matching zone first. Fixed 13-point stop and 17-point target on one contract. Strict in " +
    "New York, flexible in Asia and London. Silver is watched, never traded.",
  symbolMode: "multi",
  /* Gold is the traded leg, silver the confirmation leg. specs.ts role-locks SI
     to `confirmation`, so `tradableFeedsFor` derives the engine guard from this
     list rather than repeating the decision. */
  feeds: [GOLD, SILVER],
  params: [
    {
      key: "stopPoints",
      label: "Stop distance (points)",
      type: "number",
      default: 13,
      min: 1,
      max: 100,
      step: 0.1,
      help: "Fixed, measured from the actual fill. On MGC one point is $10, so 13 points is $130.",
    },
    {
      key: "targetPoints",
      label: "Target distance (points)",
      type: "number",
      default: 17,
      min: 1,
      max: 200,
      step: 0.1,
      help: "Fixed. 17 points on MGC is $170 — the brief's $160-170 per trade, on one contract.",
    },
    {
      key: "requireConfirm",
      label: "When silver confirmation is required",
      type: "select",
      default: "ny",
      options: [
        { value: "ny", label: "New York only (brief default)" },
        { value: "always", label: "Every session" },
        { value: "never", label: "Never — gold alone" },
      ],
      help:
        "The brief is strict in New York and flexible in Asia/London. 'always' and 'never' exist " +
        "so the rule can be measured against its own alternatives rather than assumed.",
    },
    {
      key: "allowFastSolo",
      label: "Allow a solo entry on a fast move",
      type: "boolean",
      default: true,
      help:
        "The brief's exception: when the market moves quickly and silver has no matching zone, " +
        "there is no time to wait. Off makes the confirmation requirement absolute.",
    },
    {
      key: "confirmPenetration",
      label: "How far into its zone silver must travel",
      type: "number",
      default: DEFAULT_CONFIRM_PENETRATION,
      min: 0,
      max: 1,
      step: 0.01,
      help:
        "As a fraction of the zone height. 0 accepts a bare touch. 0.33 matches the depth " +
        "zone-v5 already uses to decide whether price genuinely reached a level.",
    },
    {
      key: "maxPairDistance",
      label: "How near silver must be to its zone (zone heights)",
      type: "number",
      default: DEFAULT_MAX_PAIR_DISTANCE,
      min: 0.5,
      max: 10,
      step: 0.5,
      help:
        "Beyond this a silver zone is not a pending confirmation, it is noise — and treating it " +
        "as pending would arm the wait forever.",
    },
    {
      key: "confirmMaxLagBars",
      label: "How recent silver's visit must be (bars)",
      type: "number",
      default: DEFAULT_CONFIRM_MAX_LAG_BARS,
      min: 1,
      max: 200,
      step: 1,
      help:
        "Silver visiting its zone six hours before gold reaches its own is two unrelated events, " +
        "not two markets arriving together. 12 bars is one hour.",
    },
    {
      key: "goldPenetration",
      label: "How far into its zone gold must travel",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      help:
        "The brief mentions gold penetrating its zone significantly before the silver entry. 0 " +
        "means a touch is enough; raise it to require depth first.",
    },
  ],

  prepare(series, params, execution) {
    const symbols = Object.keys(series).filter((s) => series[s]?.length);
    const stacks: Record<string, Stack> = {};
    /* Built on the FULL series, not RTH-filtered. Gold's structure forms in
       London and Asia as much as New York, and zone-v5's own comment records
       that its RTH-structure/full-walk asymmetry cost 12 of tier A's 14
       trades. The frame options are on for the same reason they exist:
       UTC-anchored 4H bars reshape twice a year with DST, and the 80% rule
       must ask its question at the time rather than over the whole series. */
    for (const s of symbols)
      stacks[s] = buildStack(series[s], {
        sessionAnchoredFrames: true,
        causalBlocked80: true,
        globexDailyRoll: true,
      });
    void params;
    return { stacks, symbols, execution };
  },

  onSnapshot(ctx, snap: Snapshot, params: ParamValues, note: SkipNote): EntrySignal[] {
    /* Both of these used to be bare `return []`, ABOVE the "evaluated" note.
       Run this strategy on a series that has no gold in it and the funnel came
       back completely empty — no trades and no reason, which reads as "nothing
       set up today" rather than "you fed it the wrong market". */
    const gold = snap.bySymbol[GOLD];
    const goldStack = ctx.stacks[GOLD];
    if (!gold || !goldStack) {
      note("noGoldSeries", GOLD);
      return [];
    }

    const bar = gold.bars[gold.index];
    if (!bar) return [];
    const nowSec = bar.time;
    note("evaluated", GOLD);

    const session = globexSessionOf(nowSec);
    if (session === "closed") {
      note("hours", GOLD);
      return [];
    }

    const zone = activeZone(goldStack, bar.close, nowSec);
    if (!zone) {
      note("noTouch", GOLD);
      return [];
    }

    const goldDepth = penetrationDepth(zone, gold.bars, zone.firstReturnAt ?? nowSec, nowSec);
    const needDepth = Number(params.goldPenetration ?? 0);
    if (needDepth > 0 && goldDepth < needDepth) {
      note("shallowZone", GOLD);
      return [];
    }

    const mode = String(params.requireConfirm ?? "ny");
    const strict = mode === "always" || (mode === "ny" && session === "ny");

    let detail = "Gold alone (confirmation disabled)";
    let how = "solo-flexible";
    let pairedTf: string | undefined;

    if (mode !== "never") {
      const silver = snap.bySymbol[SILVER];
      const silverStack = ctx.stacks[SILVER];
      if (!silver || !silverStack) {
        /* The confirmation series is missing entirely. Under the brief that is
           not "trade it solo" — it is a data problem, and treating a missing
           feed as permission would be the quietest possible way to drop the
           rule. */
        note("noConfirmSeries", GOLD);
        return [];
      }
      const sBar = silver.bars[silver.index];
      if (!sBar) {
        note("noConfirmSeries", GOLD);
        return [];
      }
      const verdict = confirmEntry({
        goldZone: zone,
        silverZones: silverStack.all,
        silverBars: silver.bars,
        silverPrice: sBar.close,
        nowSec,
        strictSession: strict,
        goldSpeed: approachSpeed(gold.bars, gold.index),
        barSeconds: BAR_SECONDS,
        confirmPenetration: Number(params.confirmPenetration ?? DEFAULT_CONFIRM_PENETRATION),
        maxPairDistance: Number(params.maxPairDistance ?? DEFAULT_MAX_PAIR_DISTANCE),
        confirmMaxLagBars: Number(params.confirmMaxLagBars ?? DEFAULT_CONFIRM_MAX_LAG_BARS),
        allowFastSolo: params.allowFastSolo !== false,
      });
      if (!verdict.ok) {
        note(verdict.reason, GOLD);
        return [];
      }
      detail = verdict.detail;
      how = verdict.how;
      pairedTf = verdict.pairedTf;
    }

    note("qualified", GOLD);
    const side = zone.type === "demand" ? "LONG" : "SHORT";
    const stopPoints = Number(params.stopPoints ?? 13);
    const targetPoints = Number(params.targetPoints ?? 17);

    return [
      {
        symbol: GOLD,
        side,
        /* The structural stop, kept as the fill-sanity reference. stopPoints
           overrides it from the actual fill inside the engine — see
           EntrySignal.stopPoints for why both exist. */
        stop: side === "LONG" ? bar.close - stopPoints : bar.close + stopPoints,
        stopPoints,
        target: { kind: "points", points: targetPoints },
        score: zone.reaction ? 1 : 0,
        tags: {
          zoneTf: zone.tf,
          zoneType: zone.type,
          session,
          confirm: how,
          confirmDetail: detail,
          ...(pairedTf ? { confirmTf: pairedTf } : {}),
          goldDepth: goldDepth.toFixed(2),
        },
      },
    ];
  },
};
