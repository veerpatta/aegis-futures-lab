import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/types";
import { buildStack } from "@/lib/strategies/zone-v5/engine";
import { dedupeZoneRows, zoneRows, type ZoneUpsertRow } from "../scripts/engine/zone-rows";

/* The zones table enforces a natural-key unique constraint on
   (symbol, timeframe, zone_type, price_high, price_low) alongside the
   dedupe_key the engine upserts on. Price can base twice at the exact same
   level (different formedAt → different dedupe_key, identical natural key),
   which used to abort the whole zones upsert. zoneRows must emit at most one
   row per natural key, keeping the freshest formation. */

const naturalKey = (r: ZoneUpsertRow) =>
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
});
