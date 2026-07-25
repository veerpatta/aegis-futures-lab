/* Tier-A drought diagnostic — READ ONLY, no writes, no behaviour change.

   Question: tier A (zone-v5, the only fillModel:"limit" stream) has produced
   zero live signals in five weeks while the engine's 30-day funnel shows
   invalidFill: 61 — fully-qualified setups killed at the moment of entry
   (lib/backtest/engine.ts:369-377).

   Hypothesis: the zone stack is annotated on RTH-only bars
   (lib/strategies/zone-v5/index.ts:267-271, structure defaults to "rth")
   while the backtest walk iterates the full ~23h globex series. A zone
   broken at 03:00 ET is invisible to the RTH annotation, so brokenAt stays
   null and alive()/freshAt() report it alive and fresh forever; later
   overnight bars far beyond the dead zone register a "touch", emit a signal
   at the zone proximal, and are correctly rejected as invalid fills.

   Four configurations over identical bars:
     (a) production   — RTH annotation, full 23h walk
     (b) structure:"full" — full detection + annotation, full walk (the
                        existing param knob; changes zone DETECTION too)
     (b2) mixed       — RTH detection (Phase-1 rule kept), life-cycle
                        annotation re-run on the full series, full walk.
                        The isolating run: same bars and same zone set as
                        (a), only the annotation basis differs.
     (c) RTH walk     — production params with the series pre-filtered
                        through inNySession before annotation AND walk.

   Run with: npx tsx scripts/diag/tier-a.ts   (publishable key reads bars_5m)
*/

import { createClient } from "@supabase/supabase-js";
import type { Bar } from "@/lib/types";
import { runBacktest, type BacktestResult } from "@/lib/backtest/engine";
import { executeRun } from "@/lib/backtest/run";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { inNySession, nyMeta } from "@/lib/time/ny";
import { zoneV5 } from "@/lib/strategies/zone-v5";
import {
  aggregateDaily,
  annotateZones,
  buildStack,
  evaluate,
  TF_LABEL,
  type Stack,
  type Timeframe,
  type Zone,
} from "@/lib/strategies/zone-v5/engine";
import type { ParamValues, Strategy } from "@/lib/strategies/types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { EXECUTION, SESSION_EXIT_MINUTE, STARTING_CAPITAL, tierStreams } from "@/scripts/engine/tiers";

const LOOKBACK_DAYS = 60;
const PAGE = 1000;
const SYMBOLS: FeedSymbol[] = ["MES", "MNQ"];
const TFS: Timeframe[] = ["D", "240", "60", "15"];
const ANNOTATE_BUFFER = 0.25; // same buffer buildStack uses

const supabase = createClient(
  process.env.SUPABASE_URL || SUPABASE_URL,
  process.env.SUPABASE_KEY || SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
);

async function trailingBars(symbol: FeedSymbol, fromSec: number): Promise<Bar[]> {
  const out: Bar[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("bars_5m")
      .select("time, open, high, low, close, volume")
      .eq("symbol", symbol)
      .gte("time", fromSec)
      .order("time", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`bars_5m read for ${symbol}: ${error.message}`);
    for (const r of data ?? [])
      out.push({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume ?? 0),
      });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/* ── the tier-A stream, straight from the live config ──────────────────── */

function tierAStream() {
  const s = tierStreams().find((x) => x.tier === "A");
  if (!s) throw new Error("no tier A stream in tierStreams()");
  return s;
}
const tierA = tierAStream();
const pointValueOf = (symbol: string) => POINT_VALUES[symbol as FeedSymbol] ?? 1;

const etClock = (sec: number) => {
  const m = nyMeta(sec);
  return `${m.dateKey} ${String(m.hour).padStart(2, "0")}:${String(m.minute).padStart(2, "0")} ET`;
};
/* The RTH window the question asks about: 09:30–16:00 ET on a weekday.
   Deliberately WIDER than inNySession (which ends 15:30) so "outside RTH"
   cannot be inflated by the 15:30-16:00 hour. */
const inRthWide = (sec: number) => {
  const m = nyMeta(sec);
  return m.weekday !== "Sat" && m.weekday !== "Sun" && m.minutes >= 570 && m.minutes < 960;
};

/* (b2) — production detection, annotation re-run against the full series.
   Wraps zoneV5 rather than editing it: Phase 1 changes no shipped code.
   Known limitation: buildStack's reaction and 80%-rule tags were computed
   from the RTH annotations and are NOT recomputed here (both buckets are
   zero in the live funnel, so the effect is nil in practice). */
function reAnnotatedZoneV5(full: Record<string, Bar[]>): Strategy<unknown> {
  return {
    ...zoneV5,
    prepare(series, params, execution) {
      const ctx = zoneV5.prepare(series, params, execution) as {
        stacks: Record<string, Stack>;
        symbols: string[];
      };
      for (const s of ctx.symbols) {
        const bars = full[s] ?? series[s];
        for (const tf of TFS) annotateZones(ctx.stacks[s].zones[tf] ?? [], bars, ANNOTATE_BUFFER);
      }
      return ctx;
    },
  } as Strategy<unknown>;
}

interface RunSummary {
  key: string;
  label: string;
  res: BacktestResult;
}

function summarize(res: BacktestResult) {
  const m = res.metrics;
  const perDay = res.sessions ? res.trades.length / res.sessions : 0;
  return {
    qualified: res.skipReasons.qualified ?? 0,
    invalidFill: res.skipReasons.invalidFill ?? 0,
    trades: m.trades,
    sessions: res.sessions,
    perDay,
    pf: m.profitFactor,
    net: m.net,
    winRate: m.winRate,
  };
}

const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "∞");

async function main() {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - LOOKBACK_DAYS * 86400;
  const full: Record<string, Bar[]> = {};
  for (const s of SYMBOLS) full[s] = await trailingBars(s, fromSec);
  const rth: Record<string, Bar[]> = Object.fromEntries(
    SYMBOLS.map((s) => [s, full[s].filter((b) => inNySession(b.time))])
  );

  console.log(`\n=== bars_5m, trailing ${LOOKBACK_DAYS}d ===`);
  for (const s of SYMBOLS) {
    const b = full[s];
    console.log(
      `${s}: ${b.length} bars (${etClock(b[0].time)} → ${etClock(b[b.length - 1].time)}), ` +
        `${rth[s].length} inside the NY session (${((100 * rth[s].length) / b.length).toFixed(1)}%)`
    );
  }

  const seriesFor = (which: "full" | "rth") =>
    Object.fromEntries(tierA.symbols.map((s) => [s, (which === "full" ? full : rth)[s]]));
  const common = {
    execution: { ...EXECUTION, fillModel: tierA.fillModel },
    locks: tierA.locks,
    startingCapital: STARTING_CAPITAL,
    sessionExitMinute: SESSION_EXIT_MINUTE,
    pointValues: POINT_VALUES,
  };

  const runs: RunSummary[] = [];

  // (a) production, with the skip-event timeline so invalidFill bars are known.
  const resA = executeRun({
    strategyId: tierA.strategyId,
    params: tierA.params,
    series: seriesFor("full"),
    ...common,
    collectEvents: true,
  });
  runs.push({ key: "a", label: "production — RTH annotation, full 23h walk", res: resA });

  // (b) the existing structure param: detection AND annotation on the full series.
  runs.push({
    key: "b",
    label: 'structure:"full" — full detection + annotation, full walk',
    res: executeRun({
      strategyId: tierA.strategyId,
      params: { ...tierA.params, structure: "full" } as ParamValues,
      series: seriesFor("full"),
      ...common,
    }),
  });

  // (b2) isolating run: same zone set as (a), annotation basis = walk basis.
  runs.push({
    key: "b2",
    label: "mixed — RTH detection, annotation re-run on the full series, full walk",
    res: runBacktest({
      series: seriesFor("full"),
      strategy: reAnnotatedZoneV5(full),
      params: tierA.params,
      execution: common.execution,
      locks: common.locks,
      startingCapital: common.startingCapital,
      sessionExitMinute: common.sessionExitMinute,
      pointValueOf,
    }),
  });

  // (c) restrict the walk to the annotated session (both bases = RTH).
  runs.push({
    key: "c",
    label: "RTH walk — production params, series pre-filtered through inNySession",
    res: executeRun({
      strategyId: tierA.strategyId,
      params: tierA.params,
      series: seriesFor("rth"),
      ...common,
    }),
  });

  // ── funnels ────────────────────────────────────────────────────────────
  const allReasons = [
    ...new Set(runs.flatMap((r) => Object.keys(r.res.skipReasons))),
  ].sort((x, y) => (runs[0].res.skipReasons[y] ?? 0) - (runs[0].res.skipReasons[x] ?? 0));

  console.log(`\n=== skip-reason funnel (tier A, ${LOOKBACK_DAYS}d) ===`);
  const funnelRows = allReasons.map((reason) => {
    const row: Record<string, string | number> = { reason };
    for (const r of runs) row[r.key] = r.res.skipReasons[reason] ?? 0;
    return row;
  });
  console.table(funnelRows);
  for (const r of runs) console.log(`  (${r.key}) ${r.label}`);

  console.log(`\n=== outcomes ===`);
  console.table(
    runs.map((r) => {
      const s = summarize(r.res);
      return {
        run: r.key,
        qualified: s.qualified,
        invalidFill: s.invalidFill,
        trades: s.trades,
        sessions: s.sessions,
        "trades/day": num(s.perDay, 3),
        PF: num(s.pf),
        net: `$${num(s.net, 0)}`,
        "win%": num(s.winRate, 1),
      };
    })
  );
  console.log(`  tuned expectation (tiers.ts): 0.3–0.4 trades/day at PF ≈ 1.35`);

  // ── when did run (a)'s tier-A trades actually happen? ──────────────────
  // The live engine mirrors only trades with entryTime >= now-7d, and it has
  // been running since 2026-07-19. If simulated tier-A trades land inside the
  // covered window, live rows should exist and their absence is a bug; if the
  // window is empty, the drought is clustering, not a defect.
  console.log(`\n=== run (a) tier-A trades, by NY day ===`);
  console.table(
    resA.trades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      entry: etClock(t.entryTime),
      exit: etClock(t.exitTime),
      exitReason: t.exitReason,
      pnl: +t.pnl.toFixed(2),
      score: t.score ?? null,
    }))
  );

  // ── window sensitivity: slide the trailing window one day at a time ────
  // run-live simulates a trailing 60d Yahoo window; gate-costs (the funnel in
  // learned_stats) simulates a trailing 30d ARCHIVE window. Both re-detect the
  // whole zone stack from scratch every run, and candleMeta's normalizer is a
  // 14-bar rolling mean (engine.ts:219-251) — on a Daily frame built from
  // RTH-only bars a 30d window is ~21 bars, i.e. entirely inside that warm-up.
  const endSec = Math.max(...SYMBOLS.map((s) => full[s][full[s].length - 1].time));
  for (const windowDays of [30, 60] as const) {
    console.log(`\n=== window sensitivity: trailing ${windowDays}d, end slid back day by day ===`);
    const rows: Record<string, string | number>[] = [];
    for (let back = 0; back <= 10; back++) {
      const to = endSec - back * 86400;
      const from = to - windowDays * 86400;
      const series = Object.fromEntries(
        tierA.symbols.map((s) => [s, full[s].filter((b) => b.time >= from && b.time <= to)])
      );
      if (Object.values(series).some((b) => !b.length)) continue;
      const res = executeRun({
        strategyId: tierA.strategyId,
        params: tierA.params,
        series,
        ...common,
      });
      // Zone stack as the strategy builds it, to show the HTF set moving.
      const zc = { D: 0, "240": 0, "60": 0 };
      for (const s of tierA.symbols) {
        const st = buildStack(series[s].filter((b) => inNySession(b.time)));
        zc.D += (st.zones.D ?? []).length;
        zc["240"] += (st.zones["240"] ?? []).length;
        zc["60"] += (st.zones["60"] ?? []).length;
      }
      const f = res.skipReasons;
      rows.push({
        "window end": etClock(to).slice(0, 10),
        dailyZ: zc.D,
        "4hZ": zc["240"],
        "1hZ": zc["60"],
        noHtf: f.noHtf ?? 0,
        nesting: f.nesting ?? 0,
        noTouch: f.noTouch ?? 0,
        riskUnfit: f.riskUnfit ?? 0,
        weakZone: f.weakZone ?? 0,
        invalidFill: f.invalidFill ?? 0,
        qualified: f.qualified ?? 0,
        trades: res.trades.length,
        net: `$${num(res.metrics.net, 0)}`,
      });
    }
    console.table(rows);
    const spread = (k: string) => {
      const vals = rows.map((r) => Number(r[k]));
      return `${Math.min(...vals)}–${Math.max(...vals)}`;
    };
    console.log(
      `  across ${rows.length} one-day window shifts: dailyZ ${spread("dailyZ")}, ` +
        `noHtf ${spread("noHtf")}, nesting ${spread("nesting")}, qualified ${spread("qualified")}, ` +
        `invalidFill ${spread("invalidFill")}, trades ${spread("trades")}`
    );
  }

  // ── exact replication of the two nightly gate_costs windows ────────────
  // learned_stats holds the window each nightly-learn run used. The two most
  // recent runs are 13h apart and their funnels disagree by ~80%. Both windows
  // still sit inside the archive, so both are replayable bar-for-bar — which
  // separates "the window moved" from "the archive changed".
  console.log(`\n=== gate_costs replication: same archive, two nightly windows ===`);
  const NIGHTLY: { label: string; fromSec: number; toSec: number }[] = [
    { label: "2026-07-23 payload", fromSec: 1782321062, toSec: 1784913062 },
    { label: "2026-07-24 payload", fromSec: 1782368364, toSec: 1784960364 },
  ];
  /* Edge isolation: the two payload windows differ at BOTH edges by ~13h.
     Cross them to attribute the swing to the start edge (the normalizer /
     warm-up story) or the end edge (a truncated final partial day). */
  const FROM_A = 1782321062, TO_A = 1784913062;
  const FROM_B = 1782368364, TO_B = 1784960364;
  NIGHTLY.push(
    { label: "start 07-23 · end 07-24", fromSec: FROM_A, toSec: TO_B },
    { label: "start 07-24 · end 07-23", fromSec: FROM_B, toSec: TO_A }
  );
  const nightlyRows: Record<string, string | number>[] = [];
  for (const w of NIGHTLY) {
    // computeGateCosts sums the funnel across ALL tier streams, so do the same.
    const totals = new Map<string, number>();
    let tierATrades = 0;
    for (const stream of tierStreams()) {
      const series = Object.fromEntries(
        stream.symbols.map((s) => [s, full[s].filter((b) => b.time >= w.fromSec && b.time <= w.toSec)])
      );
      if (Object.values(series).every((b) => !b.length)) continue;
      const res = executeRun({
        strategyId: stream.strategyId,
        params: stream.params,
        series,
        execution: { ...EXECUTION, fillModel: stream.fillModel },
        locks: stream.locks,
        startingCapital: STARTING_CAPITAL,
        sessionExitMinute: SESSION_EXIT_MINUTE,
        pointValues: POINT_VALUES,
      });
      for (const [reason, count] of Object.entries(res.skipReasons))
        totals.set(reason, (totals.get(reason) ?? 0) + count);
      if (stream.tier === "A") tierATrades += res.trades.length;
    }
    const bars = full.MES.filter((b) => b.time >= w.fromSec && b.time <= w.toSec).length;
    nightlyRows.push({
      window: w.label,
      bars,
      noHtf: totals.get("noHtf") ?? 0,
      nesting: totals.get("nesting") ?? 0,
      noTouch: totals.get("noTouch") ?? 0,
      weakZone: totals.get("weakZone") ?? 0,
      riskUnfit: totals.get("riskUnfit") ?? 0,
      invalidFill: totals.get("invalidFill") ?? 0,
      qualified: totals.get("qualified") ?? 0,
      "tierA trades": tierATrades,
    });
  }
  console.table(nightlyRows);
  console.log(
    `  what learned_stats recorded: 07-23 → nesting 6575, noHtf 3827, weakZone 119, ` +
      `invalidFill 61, qualified 112 · 07-24 → nesting 3654, noHtf 6390, weakZone 0, ` +
      `invalidFill 4, qualified 69`
  );

  // The Daily frame's left edge for each window start. candleMeta seeds its
  // 14-bar rolling mean with bar 0's own range (engine.ts:231), so a truncated
  // first "day" mis-scales base/leg/strong for the next 14 daily bars — i.e.
  // most of a 21-bar frame.
  console.log(`\n=== Daily frame, left edge (MES, RTH bars) ===`);
  const edgeRows: Record<string, string | number>[] = [];
  for (const [label, fromSec] of [
    ["start 07-23 (06-24 13:11 ET)", FROM_A],
    ["start 07-24 (06-25 02:19 ET)", FROM_B],
  ] as const) {
    const win = full.MES.filter((b) => b.time >= fromSec && b.time <= TO_B && inNySession(b.time));
    const daily = aggregateDaily(win);
    edgeRows.push({
      "window start": label,
      "daily bars": daily.length,
      "bar 0": etClock(daily[0].time).slice(0, 10),
      "bar 0 5m bars": win.filter((b) => nyMeta(b.time).dateKey === nyMeta(daily[0].time).dateKey).length,
      "bar 0 range": +(daily[0].high - daily[0].low).toFixed(2),
      "bar 1 range": +(daily[1].high - daily[1].low).toFixed(2),
      "mean range (all)": +(
        daily.reduce((s, b) => s + (b.high - b.low), 0) / daily.length
      ).toFixed(2),
    });
  }
  console.table(edgeRows);
  console.log(`  a full RTH day is 72 five-minute bars; anything less is a truncated daily bar`);

  // ── step 4: dump run (a)'s invalidFill rejections ──────────────────────
  const stacksRth: Record<string, Stack> = {};
  for (const s of tierA.symbols) stacksRth[s] = buildStack(rth[s].length ? rth[s] : full[s]);

  // The evaluate() config the live params produce (mirrors zone-v5/index.ts
  // evalConfig with a completed-bar walk's one bar of grace).
  const cfg = {
    freshGraceSec: 300,
    targetNet: Number(tierA.params.targetNet),
    stopBuffer: Number(tierA.params.stopBuffer),
    maxRisk: EXECUTION.maxRisk,
    cost: EXECUTION.cost,
    slippage: EXECUTION.slippage,
    deepRefine15: tierA.params.deepRefine15 === true,
    zoneFallback: tierA.params.zoneFallback === true,
    scoring: tierA.params.scoring === "pdf" ? ("pdf" as const) : ("classic" as const),
    htfRangeMult: Number(tierA.params.htfRange) > 0 ? Number(tierA.params.htfRange) : 2,
    htfFallback1h: tierA.params.htf1h === true,
  };
  const barAt = (symbol: string, time: number) => full[symbol].find((b) => b.time === time) ?? null;

  /* True life-cycle timestamps against a given bar set, using annotateZones'
     own rules — so "annotated" and "true" are computed identically and only
     the bar set differs. */
  const violationOn = (z: Zone, bars: Bar[]): number | null => {
    for (const b of bars) {
      if (b.time < z.formedAt) continue;
      if (z.type === "demand" ? b.low < z.distal - ANNOTATE_BUFFER : b.high > z.distal + ANNOTATE_BUFFER)
        return b.time;
    }
    return null;
  };
  const firstReturnOn = (z: Zone, bars: Bar[]): number | null => {
    for (const b of bars) {
      if (b.time < z.formedAt) continue;
      if (z.type === "demand" ? b.low <= z.proximal : b.high >= z.proximal) return b.time;
    }
    return null;
  };

  /* Provenance of run (a)'s trades: was the entry zone still alive and fresh
     on the FULL series at the moment of entry, or only under the RTH-only
     annotation? Replays evaluate() on the same RTH stack the walk used. */
  console.log(`\n=== run (a) trade provenance: RTH annotation vs the full series ===`);
  const provenance: Record<string, string | number>[] = [];
  let onDeadZone = 0;
  let onStaleZone = 0;
  for (const t of resA.trades) {
    const bar = barAt(t.symbol, t.entryTime);
    if (!bar) continue;
    const ev = evaluate(stacksRth[t.symbol], {
      symbol: t.symbol,
      time: bar.time + 300,
      price: bar.close,
      mode: tierA.params.mode === "directional" ? "directional" : "strict",
      config: cfg,
    });
    const z = ev.entryZone;
    if (!z) continue;
    const trueBroken = violationOn(z, full[t.symbol]);
    const trueReturn = firstReturnOn(z, full[t.symbol]);
    const dead = trueBroken !== null && trueBroken <= t.entryTime;
    const stale = trueReturn !== null && trueReturn < t.entryTime;
    if (dead) onDeadZone++;
    if (stale) onStaleZone++;
    provenance.push({
      entry: etClock(t.entryTime),
      symbol: t.symbol,
      zoneTf: TF_LABEL[z.tf],
      "broken(full)": trueBroken === null ? "—" : etClock(trueBroken).slice(11),
      "broken(annotated)": z.brokenAt === null ? "—" : etClock(z.brokenAt).slice(11),
      "return(full)": trueReturn === null ? "—" : etClock(trueReturn).slice(11),
      "return(annotated)": z.firstReturnAt === null ? "—" : etClock(z.firstReturnAt).slice(11),
      "dead zone?": dead ? "YES" : "no",
      "already returned?": stale ? "YES" : "no",
      pnl: +t.pnl.toFixed(2),
    });
  }
  console.table(provenance);
  console.log(
    `${onDeadZone} of ${resA.trades.length} tier-A trades entered a zone the FULL series had ` +
      `already broken; ${onStaleZone} entered a zone the full series had already returned to. ` +
      `Both are invisible to the RTH-only annotation.`
  );

  const invalidEvents = (resA.events ?? []).filter((e) => e.reason === "invalidFill");
  console.log(`\n=== run (a) invalidFill rejections: ${invalidEvents.length} ===`);
  const dump: Record<string, string | number | null>[] = [];
  let outsideRth = 0;
  let deadZone = 0; // annotated alive, but the full series had already violated it
  let recovered = 0;
  for (const e of invalidEvents) {
    const symbol = e.symbol ?? tierA.symbols[0];
    const bar = barAt(symbol, e.time);
    if (!bar) continue;
    const ev = evaluate(stacksRth[symbol], {
      symbol,
      time: bar.time + 300,
      price: bar.close,
      mode: tierA.params.mode === "directional" ? "directional" : "strict",
      config: cfg,
    });
    const z = ev.entryZone;
    if (!z || !ev.plan) continue;
    recovered++;
    const trueBroken = violationOn(z, full[symbol]);
    const trueReturn = firstReturnOn(z, full[symbol]);
    const outside = !inRthWide(bar.time);
    if (outside) outsideRth++;
    const alreadyDead = z.brokenAt === null && trueBroken !== null && trueBroken <= bar.time;
    if (alreadyDead) deadZone++;
    dump.push({
      symbol,
      bar: etClock(bar.time),
      inRTH: outside ? "no" : "yes",
      zoneTf: TF_LABEL[z.tf],
      type: z.type,
      formedAt: etClock(z.formedAt),
      "brokenAt(annotated)": z.brokenAt === null ? "—" : etClock(z.brokenAt),
      "brokenAt(full)": trueBroken === null ? "—" : etClock(trueBroken),
      "firstReturn(annotated)": z.firstReturnAt === null ? "—" : etClock(z.firstReturnAt),
      "firstReturn(full)": trueReturn === null ? "—" : etClock(trueReturn),
      open: +bar.open.toFixed(2),
      high: +bar.high.toFixed(2),
      low: +bar.low.toFixed(2),
      close: +bar.close.toFixed(2),
      proximal: +z.proximal.toFixed(2),
      stop: +ev.plan.stop.toFixed(2),
    });
  }
  console.table(dump);
  console.log(
    `recovered ${recovered}/${invalidEvents.length} rejections via replay; ` +
      `${outsideRth} (${recovered ? ((100 * outsideRth) / recovered).toFixed(0) : 0}%) ` +
      `rejecting bars fall OUTSIDE 09:30–16:00 ET`
  );
  console.log(
    `${deadZone} (${recovered ? ((100 * deadZone) / recovered).toFixed(0) : 0}%) rejections came from a zone ` +
      `the RTH annotation reports ALIVE that the full series had already violated`
  );

  // Rejecting bars by ET hour — the entryHours:"day" window opens at 02:00 ET.
  const byHour = new Map<number, number>();
  for (const e of invalidEvents) {
    const h = nyMeta(e.time).hour;
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  console.log(`\n=== run (a) invalidFill bars by ET hour ===`);
  console.table(
    [...byHour.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([h, n]) => ({ "ET hour": `${String(h).padStart(2, "0")}:00`, count: n }))
  );

  // ── step 5: zones the RTH annotation calls alive that the full series killed ──
  console.log(`\n=== zone life-cycle: RTH annotation vs the full series ===`);
  const zoneRows: {
    symbol: string;
    tf: string;
    zones: number;
    alive: number;
    aliveButViolated: number;
    fresh: number;
    freshButReturned: number;
  }[] = [];
  for (const symbol of tierA.symbols) {
    for (const tf of TFS) {
      const zones = (stacksRth[symbol].zones[tf] ?? []).filter((z) => z.formedAt <= nowSec);
      const aliveNow = zones.filter((z) => z.brokenAt === null || z.brokenAt > nowSec);
      const phantom = aliveNow.filter((z) => {
        const t = violationOn(z, full[symbol]);
        return t !== null && t <= nowSec;
      });
      const freshNow = zones.filter((z) => z.firstReturnAt === null);
      const phantomFresh = freshNow.filter((z) => firstReturnOn(z, full[symbol]) !== null);
      zoneRows.push({
        symbol,
        tf: TF_LABEL[tf],
        zones: zones.length,
        alive: aliveNow.length,
        aliveButViolated: phantom.length,
        fresh: freshNow.length,
        freshButReturned: phantomFresh.length,
      });
    }
  }
  console.table(zoneRows);
  const sum = (pick: (r: (typeof zoneRows)[number]) => number) =>
    zoneRows.reduce((acc, r) => acc + pick(r), 0);
  console.log(
    `TOTAL: ${sum((r) => r.aliveButViolated)} of ${sum((r) => r.alive)} zones the RTH annotation ` +
      `calls ALIVE were violated by a bar in the full series; ${sum((r) => r.freshButReturned)} of ` +
      `${sum((r) => r.fresh)} it calls FRESH had already been returned to.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
