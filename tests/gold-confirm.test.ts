import { describe, expect, it } from "vitest";
import {
  approachSpeed,
  confirmEntry,
  pairedZone,
  penetrationDepth,
  reachedAt,
} from "@/lib/strategies/gold-silver-zone/confirm";
import { goldSilverZone } from "@/lib/strategies/gold-silver-zone";
import { defaultParams } from "@/lib/strategies/types";
import type { Zone } from "@/lib/strategies/zone-v5/engine";
import type { Bar } from "@/lib/types";

/* The gold/silver confirmation rule.

   Two things are being protected. First that the rule says what the brief
   says — including the case the brief leaves open (New York, no silver zone,
   slow approach), which is a skip. Second, and more important, that the whole
   decision is a pure function of visible bars: the "wait for silver" step
   reads firstReturnAt, which annotateZones stamps from the WHOLE series during
   prepare(). Reading it without a "<= now" guard would be look-ahead of the
   most dangerous kind — invisible, and flattering. */

const T0 = Date.UTC(2026, 5, 1, 22, 0) / 1000; // 18:00 ET — Globex open
const BAR = 300;

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  time: T0 + i * BAR,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 10,
});

const zone = (over: Partial<Zone> = {}): Zone =>
  ({
    tf: "60",
    tfRank: 2,
    type: "demand",
    pattern: "dbr",
    proximal: 100,
    distal: 90,
    low: 90,
    high: 100,
    height: 10,
    baseCount: 2,
    wickTolerance: false,
    wide: false,
    gapConverted: false,
    arrivalTime: T0,
    arrivalExtreme: 100,
    formedAt: T0,
    firstReturnAt: null,
    firstVisitEndAt: null,
    brokenAt: null,
    achievedAt: null,
    reaction: false,
    blocked80: null,
    ...over,
  }) as Zone;

describe("penetrationDepth", () => {
  const z = zone(); // demand 90..100, height 10
  it("is 0 when price never entered", () => {
    expect(penetrationDepth(z, [bar(0, 105, 106, 104, 105)], T0, T0 + 10 * BAR)).toBe(0);
  });

  it("is 0.5 halfway to the distal", () => {
    expect(penetrationDepth(z, [bar(0, 100, 100, 95, 97)], T0, T0 + 10 * BAR)).toBeCloseTo(0.5, 6);
  });

  it("is 1.0 at the distal", () => {
    expect(penetrationDepth(z, [bar(0, 100, 100, 90, 92)], T0, T0 + 10 * BAR)).toBeCloseTo(1, 6);
  });

  it("exceeds 1 when price runs through, and is NOT clamped", () => {
    /* Running past the far side is real information — flattening it to 1 would
       hide a zone that failed from one that just held. */
    expect(penetrationDepth(z, [bar(0, 100, 100, 85, 86)], T0, T0 + 10 * BAR)).toBeCloseTo(1.5, 6);
  });

  it("ignores bars outside the window", () => {
    const bars = [bar(0, 100, 100, 85, 86), bar(5, 100, 100, 99, 99)];
    expect(penetrationDepth(z, bars, T0 + 5 * BAR, T0 + 10 * BAR)).toBeCloseTo(0.1, 6);
  });
});

describe("reachedAt — the guard that makes this causal", () => {
  it("is null when the zone has never been touched", () => {
    expect(reachedAt(zone(), T0 + 10 * BAR)).toBeNull();
  });

  it("is null when the touch happens in the FUTURE", () => {
    /* annotateZones stamps firstReturnAt from the whole series, so the value
       is present during prepare() for a touch that has not happened yet at the
       bar being evaluated. Reading it unguarded is look-ahead. */
    const z = zone({ firstReturnAt: T0 + 20 * BAR });
    expect(reachedAt(z, T0 + 10 * BAR)).toBeNull();
  });

  it("returns the timestamp once it is in the past", () => {
    const z = zone({ firstReturnAt: T0 + 5 * BAR });
    expect(reachedAt(z, T0 + 10 * BAR)).toBe(T0 + 5 * BAR);
  });
});

describe("pairedZone", () => {
  const gold = zone({ tf: "60", tfRank: 2 });

  it("matches the same side only — gold and silver co-move", () => {
    const supply = zone({ type: "supply", proximal: 100, distal: 110, low: 100, high: 110 });
    expect(pairedZone(gold, [supply], 100, T0 + BAR)).toBeNull();
  });

  it("refuses a zone finer than gold's own frame", () => {
    const fine = zone({ tf: "15", tfRank: 3 });
    expect(pairedZone(gold, [fine], 100, T0 + BAR)).toBeNull();
  });

  it("refuses a broken zone", () => {
    const dead = zone({ brokenAt: T0 });
    expect(pairedZone(gold, [dead], 100, T0 + BAR)).toBeNull();
  });

  it("refuses a zone too far from silver's price", () => {
    /* A zone forty heights away is not a pending confirmation, it is noise —
       and calling it pending would arm the wait forever. */
    expect(pairedZone(gold, [zone()], 500, T0 + BAR, 2)).toBeNull();
  });

  it("takes the nearest qualifying zone", () => {
    const near = zone({ proximal: 100, distal: 90, low: 90, high: 100 });
    const far = zone({ proximal: 130, distal: 120, low: 120, high: 130 });
    expect(pairedZone(gold, [far, near], 101, T0 + BAR, 5)).toBe(near);
  });
});

describe("confirmEntry — the decision table", () => {
  /* A silver series that drifts at the proximal and then dips deep into the
     zone on bar 8. Depth is measured from firstReturnAt onward, so the
     penetrating bar has to sit INSIDE that window — a fixture whose deep bar
     precedes the touch measures nothing. */
  const silverSeries = [
    ...Array.from({ length: 8 }, (_, i) => bar(i, 100.5, 101, 100.2, 100.6)),
    bar(8, 100, 100, 90, 92),
    bar(9, 92, 93, 91, 92),
    bar(10, 92, 93, 91, 92),
  ];
  const base = {
    goldZone: zone(),
    silverBars: silverSeries,
    silverPrice: 95,
    nowSec: T0 + 10 * BAR,
    barSeconds: BAR,
  };

  it("waits when silver has a zone it has not reached", () => {
    const v = confirmEntry({
      ...base,
      silverZones: [zone()],
      strictSession: true,
      goldSpeed: "slow",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("awaitingSilver");
  });

  it("enters once silver has reached its zone deeply enough and recently", () => {
    const v = confirmEntry({
      ...base,
      silverZones: [zone({ firstReturnAt: T0 + 8 * BAR })],
      strictSession: true,
      goldSpeed: "slow",
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.how).toBe("silver-confirmed");
  });

  it("refuses a confirmation that is too old to mean anything", () => {
    /* Silver visiting its zone hours before gold reaches its own is two
       unrelated events, not two markets arriving together. */
    const v = confirmEntry({
      ...base,
      // Deep touch at bar 8; "now" is bar 100, so the lag is 92 bars.
      nowSec: T0 + 100 * BAR,
      silverZones: [zone({ firstReturnAt: T0 + 8 * BAR })],
      strictSession: true,
      goldSpeed: "slow",
      confirmMaxLagBars: 12,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("staleConfirm");
  });

  it("refuses a touch that never went deep enough", () => {
    const v = confirmEntry({
      ...base,
      silverBars: [bar(8, 100, 100, 99, 99)], // 10% deep
      silverZones: [zone({ firstReturnAt: T0 + 8 * BAR })],
      strictSession: true,
      goldSpeed: "slow",
      confirmPenetration: 0.33,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("awaitingSilver");
  });

  it("takes gold alone on a FAST move with no silver zone", () => {
    const v = confirmEntry({ ...base, silverZones: [], strictSession: true, goldSpeed: "fast" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.how).toBe("solo-fast");
  });

  it("SKIPS in New York on a slow move with no silver zone", () => {
    /* The case the brief leaves open. The exception exists because a fast move
       gives no time to wait; a slow one has no such excuse, and "be extremely
       cautious during New York" is the rule it would otherwise contradict. */
    const v = confirmEntry({ ...base, silverZones: [], strictSession: true, goldSpeed: "slow" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("nyNoConfirm");
  });

  it("takes the same setup solo in Asia/London", () => {
    const v = confirmEntry({ ...base, silverZones: [], strictSession: false, goldSpeed: "slow" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.how).toBe("solo-flexible");
  });
});

describe("approachSpeed", () => {
  const quiet = Array.from({ length: 8 }, (_, i) => bar(i, 100, 100.5, 99.5, 100));
  it("reads a drifting market as slow", () => {
    expect(approachSpeed(quiet, 7)).toBe("slow");
  });
  it("reads a sharp directional move as fast", () => {
    const fast = [...quiet.slice(0, 7), bar(7, 100, 100.5, 90, 90)];
    expect(approachSpeed(fast, 7)).toBe("fast");
  });
});

describe("the strategy's own defaults match the brief", () => {
  const p = defaultParams(goldSilverZone);
  it("uses a 13-point stop and a 17-point target", () => {
    expect(p.stopPoints).toBe(13);
    expect(p.targetPoints).toBe(17);
  });
  it("is strict in New York by default", () => {
    expect(p.requireConfirm).toBe("ny");
    expect(p.allowFastSolo).toBe(true);
  });
  it("never lists silver as a tradable symbol in its own id", () => {
    expect(goldSilverZone.id).toBe("gold-silver-zone");
    expect(goldSilverZone.symbolMode).toBe("multi");
  });
});
