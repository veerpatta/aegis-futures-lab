import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLiveSignal, liveOnly } from "@/lib/signals/live";
import { GO_LIVE_DATE } from "@/scripts/engine/tiers";

/* The engine's first run mirrored a trailing seven days, so it wrote rows for
   sessions that had already finished. Those rows are correct — the backtest
   acts on completed bars and never looks ahead — but they were never traded,
   and on 2026-07-31 they held +$1,441.78 against −$215.68 for everything
   genuinely live. Home's headline summed both and printed +$1,226.10.

   That is the failure these tests exist to stop coming back: a performance
   figure that includes rows the engine wrote about the past. */

const row = (signal_ts: string, pnl_usd: number | null = null) => ({ signal_ts, pnl_usd });

describe("isLiveSignal", () => {
  it("accepts go-live day itself", () => {
    // The boundary is inclusive: the first run's own signals ARE live.
    expect(isLiveSignal(`${GO_LIVE_DATE}T14:00:00Z`)).toBe(true);
  });

  it("rejects the trailing-mirror rows that predate go-live", () => {
    expect(isLiveSignal("2026-07-13T14:00:00Z")).toBe(false);
    expect(isLiveSignal("2026-07-18T14:00:00Z")).toBe(false);
  });

  it("compares on the NY trading day, not on UTC", () => {
    /* 2026-07-19T02:00Z is 2026-07-18 22:00 ET — the previous NY day, and so
       NOT live, even though its UTC date is go-live day. Getting this wrong
       would let a backfilled row through on exactly the boundary the whole
       filter is about. */
    expect(isLiveSignal("2026-07-19T02:00:00Z")).toBe(false);
  });
});

describe("liveOnly", () => {
  const signals = [
    row("2026-07-13T14:00:00Z", 700),
    row("2026-07-16T14:00:00Z", 741.78),
    row("2026-07-19T14:00:00Z", -100),
    row("2026-07-30T14:00:00Z", -115.68),
  ];

  it("drops the backfilled rows and keeps the live ones", () => {
    expect(liveOnly(signals).map((s) => s.signal_ts)).toEqual([
      "2026-07-19T14:00:00Z",
      "2026-07-30T14:00:00Z",
    ]);
  });

  it("flips the sign of the headline — which is the entire point", () => {
    const sum = (rows: typeof signals) => rows.reduce((a, s) => a + (s.pnl_usd ?? 0), 0);
    expect(sum(signals)).toBeGreaterThan(0); // what Home used to print
    expect(sum(liveOnly(signals))).toBeLessThan(0); // what is actually true
  });

  it("is a no-op when every row is live", () => {
    const live = signals.slice(2);
    expect(liveOnly(live)).toHaveLength(live.length);
  });

  it("returns an empty list rather than throwing on no input", () => {
    expect(liveOnly([])).toEqual([]);
  });

  it("keeps revised-away rows for audit but excludes them from live performance", () => {
    const rows = [
      { ...row("2026-07-30T14:00:00Z", 50), orphaned: false },
      { ...row("2026-07-30T15:00:00Z", 900), orphaned: true },
    ];
    expect(liveOnly(rows)).toEqual([rows[0]]);
  });
});

/* ── The structural guard ─────────────────────────────────────────────────
   "Performance aggregation goes through liveOnly" is an invariant with nothing
   in the type system to enforce it. This session fixed the bars_5m guards TWICE
   for exactly that reason — a hand-maintained list rots, and its sibling's
   discovery walk missed a whole directory. Rather than repeat the lesson, the
   new invariant gets a discovery guard on the same day it is introduced.

   Every module that reads the `signals` table must appear in MUST_FILTER or in
   EXEMPT with a written reason, and MUST_FILTER members must import liveOnly. */
describe("every signals reader is classified", () => {
  const MUST_FILTER = [
    "components/home/HomeClient.tsx", // headline P&L, the card that was wrong
    "components/review/ReviewClient.tsx", // P&L calendar + year heatmap
    "components/signals/SignalsClient.tsx", // the feed's performance panel
    "scripts/diag/nightly-research.ts", // mirrors the breaker's rolling PF
    "scripts/engine/breakers.ts", // rolling PF -> PAUSES a stream
    "scripts/engine/digest.ts", // the weekly Telegram digest
    "scripts/engine/learn.ts", // calibration + the win-prob training set
    "scripts/engine/tune.ts", // VIX-bucket split, no time window at all
  ];

  const EXEMPT: Record<string, string> = {
    "scripts/engine/debrief.ts":
      "filters to ONE trading day and reports that day; a backfilled row cannot reach today's " +
      "debrief, and filtering would make no difference to any day it can report on",
    "scripts/engine/model.ts":
      "reads win_prob and dedupe_key to check model coverage; sums no P&L and makes no " +
      "performance claim, so there is nothing for a backfilled row to distort",
    "scripts/engine/run-live.ts":
      "the WRITER — it inserts and closes signal rows. Filtering its own reads would make it " +
      "unable to find and update the rows it wrote",
    "scripts/engine/backfill-fill-audit.ts":
      "re-judges the fill confidence stored ON each row, one row at a time; it is a data " +
      "correction pass over history, so excluding history is exactly wrong for it",
  };

  /* A reader may name the table inline OR pass it to a generic helper. The
     first version of this guard only matched `from("signals")` and so missed
     scripts/engine/learn.ts, which goes through fetchAll<SignalRow>("signals",
     …) — the single most consequential reader in the list, since the breakers
     and the win-prob training set both hang off it. Exactly the hole the
     bars_5m guards had, found the same way: by running the guard. */
  const readsSignals = (src: string): boolean =>
    /from\("signals"\)/.test(src) || /fetchAll\w*(?:<[^>]*>)?\(\s*"signals"/.test(src);

  it("finds every signals reader, and every one is classified", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
          const src = readFileSync(join(process.cwd(), rel), "utf8");
          if (readsSignals(src)) found.push(rel);
        }
      }
    };
    ["app", "components", "lib", "scripts"].forEach(walk);
    expect(
      found.sort(),
      "a module reads the signals table without appearing in MUST_FILTER or EXEMPT — decide " +
        "which, with a reason. If it sums pnl_usd it belongs in MUST_FILTER."
    ).toEqual([...MUST_FILTER, ...Object.keys(EXEMPT)].sort());
  });

  it.each(MUST_FILTER)("%s runs its signal rows through liveOnly", (path) => {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    expect(readsSignals(src), `${path} no longer reads signals — update this guard`).toBe(true);
    expect(src, `${path} aggregates signals without liveOnly`).toMatch(/\bliveOnly\s*\(/);
  });

  it.each([
    "scripts/diag/nightly-research.ts",
    "scripts/engine/breakers.ts",
    "scripts/engine/digest.ts",
    "scripts/engine/learn.ts",
    "scripts/engine/tune.ts",
  ])("%s selects the orphan marker before filtering", (path) => {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    expect(src, `${path} cannot exclude revised-away rows it did not select`).toContain("orphaned");
  });

  it("keeps a stated reason for every exemption", () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(readsSignals(readFileSync(join(process.cwd(), path), "utf8")), path).toBe(true);
      expect(reason.length, `${path}'s exemption reason is too thin`).toBeGreaterThan(30);
    }
  });
});
