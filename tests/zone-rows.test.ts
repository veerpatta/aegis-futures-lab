import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { buildStack, scoreZoneAt, type Timeframe } from "@/lib/strategies/zone-v5/engine";
import {
  dedupeZoneRows,
  rowsToDelete,
  zoneRows,
  type ExistingZoneRow,
  type ZoneUpsertRow,
} from "../scripts/engine/zone-rows";

/* The zones table enforces a natural-key unique constraint on
   (symbol, timeframe, zone_type, price_high, price_low) alongside the
   dedupe_key the engine upserts on. Price can base twice at the exact same
   level (different formedAt → different dedupe_key, identical natural key),
   which used to abort the whole zones upsert. zoneRows must emit at most one
   row per natural key, keeping the freshest formation. */

const naturalKey = (r: ZoneUpsertRow | ExistingZoneRow) =>
  `${r.symbol}|${r.timeframe}|${r.zone_type}|${r.price_high}|${r.price_low}`;

/* Expand one 15-minute candle spec into three aligned 5m bars: the first
   carries the full range, the remaining two sit flat at the close, so the
   15m aggregation reproduces the spec exactly. */
function candle(t: number, o: number, h: number, l: number, c: number): Bar[] {
  return [
    { time: t, open: o, high: h, low: l, close: c, volume: 0 },
    { time: t + 300, open: c, high: c, low: c, close: c, volume: 0 },
    { time: t + 600, open: c, high: c, low: c, close: c, volume: 0 },
  ];
}

/* A NY-session morning where price bases at 95–105 twice (identical base
   candle both times) with a strong rally away each time: two DBR demand
   zones at identical price levels, formed at different times. All candles
   have a 10-point range so the rolling average stays flat. */
function twinZoneBars(): Bar[] {
  const start = Math.floor(Date.UTC(2026, 6, 6, 13, 30) / 1000); // Mon 2026-07-06 09:30 ET
  const specs: [number, number, number, number][] = [
    [100, 110, 100, 110], // seed legs — alternate ±10, never a base
    [110, 110, 100, 100],
    [100, 110, 100, 110],
    [110, 110, 100, 100],
    [100, 110, 100, 110],
    [110, 110, 100, 100], // arrival drop into the first base
    [100, 105, 95, 101], //  base #1 (distal 95, proximal 101)
    [101, 111, 101, 111], // strong departure — first DBR demand zone
    [111, 116, 106, 110], // drift candle
    [110, 110, 100, 100], // arrival drop into the second base
    [100, 105, 95, 101], //  base #2 — same levels, later time
    [101, 111, 101, 111], // strong departure — duplicate DBR demand zone
  ];
  return specs.flatMap((s, i) => candle(start + i * 900, ...s));
}

describe("dedupeZoneRows", () => {
  const row = (over: Partial<ZoneUpsertRow>): ZoneUpsertRow => ({
    dedupe_key: "MES:15M:demand:1",
    symbol: "MES",
    timeframe: "15M",
    zone_type: "demand",
    price_high: 101,
    price_low: 95,
    score: 80,
    status: "fresh",
    fresh: true,
    achieved: false,
    blocked80: false,
    touches: 0,
    source_candle_ts: "2026-07-06T14:30:00.000Z",
    active: true,
    updated_at: "2026-07-06T18:00:00.000Z",
    ...over,
  });

  it("keeps only the freshest formation of a duplicated price level", () => {
    const older = row({ dedupe_key: "MES:15M:demand:1", source_candle_ts: "2026-07-06T14:30:00.000Z" });
    const newer = row({ dedupe_key: "MES:15M:demand:2", source_candle_ts: "2026-07-06T15:30:00.000Z" });
    const out = dedupeZoneRows([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].dedupe_key).toBe("MES:15M:demand:2");
  });

  it("keeps rows whose natural keys differ", () => {
    const a = row({});
    const b = row({ dedupe_key: "MES:15M:supply:1", zone_type: "supply" });
    const c = row({ dedupe_key: "MNQ:15M:demand:1", symbol: "MNQ" });
    const d = row({ dedupe_key: "MES:1h:demand:1", timeframe: "1H" });
    expect(dedupeZoneRows([a, b, c, d])).toHaveLength(4);
  });
});

/* The prune that runs before the zones upsert. Keying it on dedupe_key alone
   still let a 23505 through against the natural-key constraint — four times in
   the 118 runs the 2026-07-25 digest covers — because a surviving row can hold
   a natural key that a DIFFERENT row of the new snapshot now claims. Only exact
   matches on BOTH keys may survive. */
describe("rowsToDelete", () => {
  const existing = (over: Partial<ExistingZoneRow>): ExistingZoneRow => ({
    id: 1,
    dedupe_key: "MES:15M:demand:1",
    symbol: "MES",
    timeframe: "15M",
    zone_type: "demand",
    price_high: 101,
    price_low: 95,
    ...over,
  });
  const snap = (over: Partial<ZoneUpsertRow>): ZoneUpsertRow => ({
    dedupe_key: "MES:15M:demand:1",
    symbol: "MES",
    timeframe: "15M",
    zone_type: "demand",
    price_high: 101,
    price_low: 95,
    score: 80,
    status: "fresh",
    fresh: true,
    achieved: false,
    blocked80: false,
    touches: 0,
    source_candle_ts: "2026-07-06T14:30:00.000Z",
    active: true,
    updated_at: "2026-07-06T18:00:00.000Z",
    ...over,
  });

  it("keeps a row that matches the snapshot on both keys", () => {
    expect(rowsToDelete([existing({})], [snap({})])).toEqual([]);
  });

  it("deletes a row the snapshot no longer carries", () => {
    expect(rowsToDelete([existing({ id: 7 })], [])).toEqual([7]);
    expect(
      rowsToDelete([existing({ id: 7 })], [snap({ dedupe_key: "MES:15M:demand:2" })])
    ).toEqual([7]);
  });

  /* The case the dedupe_key-only prune missed. A zone's price_high/price_low
     can move while its dedupe_key does not — formedAt is the aggregated frame
     bar's bucket time, and that bar keeps widening while it is still forming.
     The stale row then sits on a level another snapshot row claims, and the
     upsert order decides whether Postgres raises 23505. */
  it("deletes a row whose dedupe_key survived but whose natural key moved", () => {
    const stale = existing({ id: 7, price_high: 101 });
    const snapshot = [
      snap({ dedupe_key: "MES:15M:demand:1", price_high: 104 }), // widened
      snap({ dedupe_key: "MES:15M:demand:9", price_high: 101 }), // now claims 101
    ];
    expect(rowsToDelete([stale], snapshot)).toEqual([7]);
  });

  it("leaves no surviving row holding a natural key another snapshot row claims", () => {
    const rowsInDb = [
      existing({ id: 1, dedupe_key: "MES:15M:demand:1", price_high: 101 }),
      existing({ id: 2, dedupe_key: "MES:15M:demand:2", price_high: 110, price_low: 104 }),
      existing({ id: 3, dedupe_key: "MNQ:1H:supply:5", symbol: "MNQ", timeframe: "1H", zone_type: "supply" }),
    ];
    const snapshot = [
      snap({ dedupe_key: "MES:15M:demand:1", price_high: 104, price_low: 95 }),
      snap({ dedupe_key: "MES:15M:demand:9", price_high: 101, price_low: 95 }),
      snap({ dedupe_key: "MES:15M:demand:2", price_high: 110, price_low: 104 }),
    ];
    const doomed = new Set(rowsToDelete(rowsInDb, snapshot));
    const survivors = rowsInDb.filter((r) => !doomed.has(r.id));
    const claimed = new Map(snapshot.map((r) => [naturalKey(r), r.dedupe_key]));
    // Every survivor's natural key is claimed by the snapshot row it IS.
    for (const s of survivors) expect(claimed.get(naturalKey(s))).toBe(s.dedupe_key);
    // id 2 is untouched, id 1 (moved) and id 3 (gone) are cleared.
    expect([...doomed].sort()).toEqual([1, 3]);
  });

  it("clears the whole table when the snapshot is empty", () => {
    const rowsInDb = [existing({ id: 1 }), existing({ id: 2, dedupe_key: "x" })];
    expect(rowsToDelete(rowsInDb, [])).toEqual([1, 2]);
  });
});

describe("zoneRows", () => {
  const bars = twinZoneBars();
  const nowSec = bars[bars.length - 1].time + 300;

  it("the scenario really forms two zones at identical price levels", () => {
    const stack = buildStack(bars);
    const twins = (stack.zones["15"] || []).filter(
      (z) => z.type === "demand" && z.low === 95 && z.high === 101
    );
    expect(twins.length).toBe(2);
    expect(twins[0].formedAt).not.toBe(twins[1].formedAt);
  });

  it("emits no natural-key duplicates and keeps the freshest formation", () => {
    const rows = zoneRows("MES", bars, nowSec);
    const keys = rows.map(naturalKey);
    expect(new Set(keys).size).toBe(keys.length);

    const twins = rows.filter(
      (r) => r.timeframe === "15M" && r.zone_type === "demand" && r.price_high === 101 && r.price_low === 95
    );
    expect(twins).toHaveLength(1);
    // The kept row is the later formation: formedAt is baked into dedupe_key.
    const stack = buildStack(bars);
    const formed = (stack.zones["15"] || [])
      .filter((z) => z.type === "demand" && z.low === 95 && z.high === 101)
      .map((z) => z.formedAt)
      .sort((a, b) => a - b);
    expect(twins[0].dedupe_key).toBe(`MES:15M:demand:${formed[formed.length - 1]}`);
  });

  /* Item 2.1 — the odds-enhancer score used to be computed inside the strategy
     and dropped at the persistence boundary, leaving every zones row null and
     learned_stats.score_calibration permanently empty. */
  it("round-trips a non-null score on every visible zone row", () => {
    const rows = zoneRows("MES", bars, nowSec);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.score).not.toBeNull();
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("scores a zone the same way a signal on that zone would be scored", () => {
    const rows = zoneRows("MES", bars, nowSec);
    const stack = buildStack(bars);
    const tfKey: Record<string, Timeframe> = { Daily: "D", "4H": "240", "1H": "60", "15M": "15" };
    let checked = 0;
    for (const r of rows) {
      // dedupe_key ends in the zone's formedAt, which is what distinguishes two
      // formations at an identical price level (the twin-zone case above).
      const formedAt = Number(r.dedupe_key.split(":").pop());
      const zone = (stack.zones[tfKey[r.timeframe]] || []).find(
        (z) => z.formedAt === formedAt && z.type === r.zone_type && z.high === r.price_high
      );
      expect(zone).toBeDefined();
      // Same function evaluate() feeds for signals.score — not a re-derivation.
      expect(r.score).toBe(scoreZoneAt(stack, zone!, "MES", nowSec));
      checked++;
    }
    expect(checked).toBe(rows.length);
  });
});
