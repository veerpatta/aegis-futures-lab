import { describe, expect, it, vi } from "vitest";
import { ZoneBoxPrimitive, zoneToBox, type ZoneBox, type ZoneLike } from "@/components/chart/zoneBoxes";

/* Zone rectangles. The canvas itself cannot be screenshotted in CI, so the
   geometry is asserted directly: the mapping that decides which edge is the
   entry, the autoscale that keeps an off-range zone from vanishing silently,
   and the draw calls that distinguish the proximal line from the distal one. */

const zone = (over: Partial<ZoneLike> = {}): ZoneLike => ({
  zone_type: "demand",
  price_high: 5010,
  price_low: 5000,
  status: "fresh",
  timeframe: "1H",
  ...over,
});

describe("zoneToBox — the asymmetry that is easy to get backwards", () => {
  it("a demand zone is entered at its HIGH, with the stop below its low", () => {
    /* Price falls into demand from above, so the near edge is the top. Swap
       this and every stop is drawn on the profitable side of every entry. */
    const b = zoneToBox(zone({ zone_type: "demand" }));
    expect(b.proximal).toBe(5010);
    expect(b.distal).toBe(5000);
    expect(b.proximal).toBeGreaterThan(b.distal);
  });

  it("a supply zone is the exact mirror", () => {
    const b = zoneToBox(zone({ zone_type: "supply" }));
    expect(b.proximal).toBe(5000);
    expect(b.distal).toBe(5010);
    expect(b.proximal).toBeLessThan(b.distal);
  });

  it("carries the kind through for colouring", () => {
    expect(zoneToBox(zone({ zone_type: "demand" })).kind).toBe("demand");
    expect(zoneToBox(zone({ zone_type: "supply" })).kind).toBe("supply");
  });

  it("dims a tested zone relative to a fresh one", () => {
    expect(zoneToBox(zone({ status: "fresh" })).freshness).toBe(1);
    expect(zoneToBox(zone({ status: "tested" })).freshness!).toBeLessThan(1);
  });

  it("labels in trading language, not schema language", () => {
    expect(zoneToBox(zone({ zone_type: "demand", timeframe: "4H" })).label).toBe("4H buy · fresh");
    expect(zoneToBox(zone({ zone_type: "supply", status: "tested" })).label).toBe(
      "1H sell · tested"
    );
  });
});

/* ── The primitive ────────────────────────────────────────────────────── */

const fakeSeries = (map: (p: number) => number | null) =>
  ({ priceToCoordinate: (p: number) => map(p) }) as never;

const fakeChart = (x: number | null = 0) =>
  ({ timeScale: () => ({ timeToCoordinate: () => x }) }) as never;

/** Records every canvas operation so the drawing can be asserted. */
function recordingTarget(width = 600, height = 300) {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "",
    fillRect: (...a: unknown[]) => calls.push({ op: "fillRect", args: a }),
    beginPath: () => calls.push({ op: "beginPath", args: [] }),
    moveTo: (...a: unknown[]) => calls.push({ op: "moveTo", args: a }),
    lineTo: (...a: unknown[]) => calls.push({ op: "lineTo", args: a }),
    stroke: () => calls.push({ op: "stroke", args: [] }),
    fillText: (...a: unknown[]) => calls.push({ op: "fillText", args: a }),
    setLineDash: (...a: unknown[]) => calls.push({ op: "setLineDash", args: a }),
  };
  return {
    calls,
    ctx,
    target: {
      useMediaCoordinateSpace: (cb: (s: unknown) => void) =>
        cb({ context: ctx, mediaSize: { width, height } }),
    },
  };
}

describe("ZoneBoxPrimitive draws", () => {
  // Linear price→y: 5000 → 200, 5010 → 100 (y grows downward).
  const priceToY = (p: number) => 200 - (p - 5000) * 10;
  const boxes: ZoneBox[] = [zoneToBox(zone())];

  it("fills the band between the two edges", () => {
    const { calls, target } = recordingTarget();
    const p = new ZoneBoxPrimitive(boxes, fakeSeries(priceToY), fakeChart());
    p.paneViews()[0].renderer()!.draw(target as never);
    const fill = calls.find((c) => c.op === "fillRect");
    expect(fill).toBeDefined();
    const [x, y, w, h] = fill!.args as number[];
    expect(x).toBe(0);
    expect(y).toBe(100); // top = min(y(5010), y(5000))
    expect(h).toBe(100); // |200 − 100|
    expect(w).toBe(600);
  });

  it("draws the proximal edge SOLID and the distal edge DASHED", () => {
    const { calls, target } = recordingTarget();
    const p = new ZoneBoxPrimitive(boxes, fakeSeries(priceToY), fakeChart());
    p.paneViews()[0].renderer()!.draw(target as never);

    const dashCalls = calls.filter((c) => c.op === "setLineDash");
    // Solid first (empty pattern), then dashed, then reset.
    expect(dashCalls[0].args[0]).toEqual([]);
    expect(dashCalls[1].args[0]).toEqual([3, 3]);

    const moves = calls.filter((c) => c.op === "moveTo").map((c) => (c.args as number[])[1]);
    // Proximal (5010 → y 100) stroked before distal (5000 → y 200).
    expect(moves[0]).toBe(100);
    expect(moves[1]).toBe(200);
  });

  it("starts at the left edge when the zone has no formation time", () => {
    const { calls, target } = recordingTarget();
    new ZoneBoxPrimitive(boxes, fakeSeries(priceToY), fakeChart())
      .paneViews()[0]
      .renderer()!
      .draw(target as never);
    expect((calls.find((c) => c.op === "fillRect")!.args as number[])[0]).toBe(0);
  });

  it("skips a zone the price scale cannot place rather than drawing at NaN", () => {
    const { calls, target } = recordingTarget();
    new ZoneBoxPrimitive(boxes, fakeSeries(() => null), fakeChart())
      .paneViews()[0]
      .renderer()!
      .draw(target as never);
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
  });

  it("draws nothing at all when there are no zones", () => {
    const { calls, target } = recordingTarget();
    new ZoneBoxPrimitive([], fakeSeries(priceToY), fakeChart())
      .paneViews()[0]
      .renderer()!
      .draw(target as never);
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
  });

  it("renders behind the candles, never over them", () => {
    const p = new ZoneBoxPrimitive(boxes, fakeSeries(priceToY), fakeChart());
    expect(p.paneViews()[0].zOrder!()).toBe("bottom");
  });
});

describe("ZoneBoxPrimitive autoscale", () => {
  it("widens the price range to include every zone", () => {
    /* Without this a zone outside the current range is simply invisible, and
       "no zone nearby" and "the zone is off-screen" look identical. */
    const boxes = [
      zoneToBox(zone({ price_low: 4900, price_high: 4910 })),
      zoneToBox(zone({ price_low: 5100, price_high: 5110, zone_type: "supply" })),
    ];
    const info = new ZoneBoxPrimitive(boxes, fakeSeries(() => 0), fakeChart()).autoscaleInfo();
    expect(info).toEqual({ priceRange: { minValue: 4900, maxValue: 5110 } });
  });

  it("returns null with no zones, leaving the scale alone", () => {
    expect(new ZoneBoxPrimitive([], fakeSeries(() => 0), fakeChart()).autoscaleInfo()).toBeNull();
  });
});
