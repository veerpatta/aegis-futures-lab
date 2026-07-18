/* Strategy v5 (demand & supply zone engine) wrapped in the generic strategy
   contract. The candidate flow mirrors legacy/outcomes.js runOutcome():
   evaluate each market on the completed bar, require a proximal touch,
   confirm intermarket agreement, prefer the MES zone on fast approaches. */

import type { Bar } from "@/lib/types";
import { inNySession, nyMeta } from "@/lib/time/ny";
import { TF_LABEL, buildStack, evaluate, intermarketCheck } from "./engine";
import type { Stack, EvalResult, Timeframe } from "./engine";
import type {
  EntrySignal,
  ExecutionConfig,
  ParamValues,
  ReadoutRow,
  SkipNote,
  Snapshot,
  Strategy,
} from "@/lib/strategies/types";

interface ZoneCtx {
  stacks: Record<string, Stack>;
  symbols: string[];
  execution: ExecutionConfig;
}

function evalConfig(params: ParamValues, execution: ExecutionConfig) {
  return {
    freshGraceSec: 300, // a completed-bar walk gets one bar of grace, as in the legacy study
    targetNet: Number(params.targetNet),
    stopBuffer: Number(params.stopBuffer),
    maxRisk: execution.maxRisk,
    cost: execution.cost,
    slippage: execution.slippage,
    // Opt-in (=== true / === "pdf") so runs that omit them keep exact legacy behavior.
    deepRefine15: params.deepRefine15 === true,
    zoneFallback: params.zoneFallback === true,
    scoring: params.scoring === "pdf" ? ("pdf" as const) : ("classic" as const),
    htfRangeMult: Number(params.htfRange) > 0 ? Number(params.htfRange) : 2,
  };
}

function evaluateVisible(
  ctx: ZoneCtx,
  snap: Snapshot,
  params: ParamValues
): Record<string, { ev: EvalResult; bar: Bar; index: number; bars: Bar[] }> {
  const cfg = evalConfig(params, ctx.execution);
  const mode = params.mode === "directional" ? "directional" : "strict";
  const out: Record<string, { ev: EvalResult; bar: Bar; index: number; bars: Bar[] }> = {};
  for (const symbol of ctx.symbols) {
    const vis = snap.bySymbol[symbol];
    if (!vis) continue;
    const bar = vis.bars[vis.index];
    out[symbol] = {
      ev: evaluate(ctx.stacks[symbol], {
        symbol,
        time: bar.time + 300,
        price: bar.close,
        mode,
        config: cfg,
      }),
      bar,
      index: vis.index,
      bars: vis.bars,
    };
  }
  return out;
}

export const zoneV5: Strategy<ZoneCtx> = {
  id: "zone-v5",
  name: "Zone Engine v5",
  blurb:
    "Institutional demand & supply zones (DBR/RBR/RBD/DBD) with Daily→4H→1H alignment, freshness, the 80% rule, odds-enhancer scoring (fresh/trend/departure/margin/base), risk-adaptive 15M refinement and MES/MNQ intermarket confirmation. Targets: dollar band, next opposing zone, or fixed R; breakeven + trailing stop management.",
  flagship: true,
  symbolMode: "multi",
  params: [
    {
      key: "mode",
      label: "Nesting mode",
      type: "select",
      default: "directional",
      options: [
        { value: "strict", label: "Strict v5 (rectangle nesting)" },
        { value: "directional", label: "Directional v4 (comparison)" },
      ],
      help: "Directional requires same-side Daily/4H/1H agreement (the default — takes trades on the delayed feed). Strict additionally requires 1H zones nested inside the Daily/4H rectangle; it is far more selective and often qualifies no setups.",
    },
    {
      key: "targetNet",
      label: "Net dollar target",
      type: "number",
      default: 162.5,
      min: 50,
      max: 400,
      step: 12.5,
      unit: "$",
      help: "Net profit target per trade; the point target is derived from the actual fill and quantity.",
    },
    {
      key: "stopBuffer",
      label: "Stop buffer",
      type: "number",
      default: 0.25,
      min: 0,
      max: 2,
      step: 0.25,
      unit: "pt",
      help: "Points beyond the distal zone line for the structural stop.",
    },
    {
      key: "minScore",
      label: "Minimum zone score",
      type: "number",
      default: 0,
      min: 0,
      max: 100,
      step: 5,
      help: "Skip setups scoring below this (0 = take every qualified setup).",
    },
    {
      key: "intermarket",
      label: "Intermarket confirmation",
      type: "boolean",
      default: true,
      help: "Require MES and MNQ directional agreement (auto-off when only one series is loaded).",
    },
    {
      key: "secondZone",
      label: "Second-zone rule (MNQ/MES)",
      type: "boolean",
      default: true,
      help: "On fast approaches, the first market to reach its zone usually fails (~90% observed). Skip it and wait for the second market to reach its own corresponding zone.",
    },
    {
      key: "requireAchieved",
      label: "Weak-zone filter",
      type: "select",
      default: "ny",
      options: [
        { value: "off", label: "Off" },
        { value: "ny", label: "NY session (skip un-achieved 1H zones)" },
        { value: "always", label: "Always require achievement" },
      ],
      help: "Ordinary 1H zones that have not achieved anything (broken structure or an opposing zone) fail ~50% of the time in the New York session. 'NY session' skips them there in every mode; 'Always' trades only achieved zones.",
    },
    {
      key: "breakevenR",
      label: "Breakeven after (R)",
      type: "number",
      default: 0,
      min: 0,
      max: 2,
      step: 0.25,
      help: "Move the stop to the entry price once the previous completed bar closes this many R in profit (0 = off).",
    },
    {
      key: "trailR",
      label: "Trailing stop (R)",
      type: "number",
      default: 0,
      min: 0,
      max: 3,
      step: 0.25,
      help: "Once the previous completed bar closes this many R in profit, trail the stop this many R behind each new close (tighten-only; 0 = off).",
    },
    {
      key: "targetMode",
      label: "Profit target",
      type: "select",
      default: "r2",
      options: [
        { value: "r2", label: "2R" },
        { value: "r3", label: "3R" },
        { value: "zone", label: "Next opposing zone" },
        { value: "dollar", label: "Net dollar target ($160–165 band)" },
      ],
      help: "Phase-7 target selection. 'Next opposing zone' exits at the nearest visible supply/demand zone past the entry (falls back to the dollar target when none is in view or the margin is under 1R).",
    },
    {
      key: "scoring",
      label: "Zone scoring",
      type: "select",
      default: "pdf",
      options: [
        { value: "pdf", label: "Odds enhancers (fresh/trend/departure/margin/base)" },
        { value: "classic", label: "Classic v5 additive score" },
      ],
      help: "Phase-4 odds-enhancer checklist: Fresh 20 · Trend alignment 20 · Strong departure 20 · Profit margin 20 · Little time at base 20. Pair with the minimum-score gate to trade only high-scoring zones.",
    },
    {
      key: "structure",
      label: "Zone structure from",
      type: "select",
      default: "rth",
      options: [
        { value: "rth", label: "NY session bars only (ignore overnight)" },
        { value: "full", label: "Full ~23h globex session" },
      ],
      help: "Phase-1 rule: 'Ignore Asian session, ignore overnight trades.' NY-session structure keeps thin overnight wicks from consuming a zone's freshness or distorting the candle grammar; 'full' uses every bar the feed provides.",
    },
    {
      key: "entryStyle",
      label: "Entry trigger",
      type: "select",
      default: "limit",
      options: [
        { value: "limit", label: "Resting limit at the zone line" },
        { value: "confirm", label: "Confirmation candle (rejection close)" },
      ],
      help: "Phase-5 entry: 'Confirmation candle' waits for a bar that touches the zone and closes back in the trade direction (avoids catching momentum that blows straight through); 'Limit' rests an order at the proximal and fills on the touch.",
    },
    {
      key: "entryHours",
      label: "Entry session",
      type: "select",
      default: "rth",
      options: [
        { value: "rth", label: "NY session only (09:30–15:25 ET)" },
        { value: "day", label: "London + New York (02:00–15:25 ET, more trades)" },
        { value: "all", label: "Any hour before the 15:25 flat" },
      ],
      help: "Phase-1 trading-hours rule. Entries outside the chosen window are skipped; open positions still manage around the clock and flatten by 15:25 ET.",
    },
    {
      key: "htfRange",
      label: "HTF zone range (× height)",
      type: "number",
      default: 2,
      min: 1,
      max: 8,
      step: 1,
      help: "How far (in zone-heights) a Daily/4H zone may sit from price and still anchor a setup. The legacy engine used 2; wider values watch zones sooner and catch more touches.",
    },
    {
      key: "deepRefine15",
      label: "Deep 15M refinement",
      type: "boolean",
      default: true,
      help: "When the 1H stop exceeds the risk cap, scan every fresh 15M zone nested in the 1H for one that fits (off = legacy nearest-only check).",
    },
    {
      key: "zoneFallback",
      label: "Prefer fresh 1H zones",
      type: "boolean",
      default: true,
      help: "Pick the nearest FRESH, unblocked 1H zone even when a stale one sits closer (off = legacy nearest-zone pick).",
    },
  ],

  prepare(series, params, execution) {
    const symbols = Object.keys(series).sort(); // MES before MNQ
    const stacks: Record<string, Stack> = {};
    // Phase-1 "ignore overnight trades": with structure = "rth" the zone
    // stack (detection, freshness, achievement) is built from NY-session
    // bars only, so thin overnight wicks can neither create zones nor
    // consume a zone's first return. Absent/full keeps every bar (legacy).
    const rthOnly = params.structure === "rth";
    for (const s of symbols) {
      const bars = rthOnly ? series[s].filter((b) => inNySession(b.time)) : series[s];
      stacks[s] = buildStack(bars.length ? bars : series[s]);
    }
    return { stacks, symbols, execution };
  },

  onSnapshot(ctx, snap, params, note: SkipNote) {
    const evals = evaluateVisible(ctx, snap, params);
    const signals: EntrySignal[] = [];
    const useIntermarket = params.intermarket !== false && ctx.symbols.length > 1;
    for (const symbol of ctx.symbols) {
      const v = evals[symbol];
      if (!v) continue;
      const { ev, bar, index, bars } = v;
      note("evaluated");
      if (ev.bucket) {
        note(ev.bucket);
        continue;
      }
      if (ev.refined15) note("refined15");
      if (ev.nyCaution) note("nyCaution");
      // Weak-zone filter (voice note): ordinary zones that have not achieved
      // anything are skipped — everywhere ("always") or in the NY session
      // ("ny", where ~50% of standalone 1H zones break). The engine already
      // enforces this for directional mode in NY; this extends it to strict.
      if (params.requireAchieved === "always" && !ev.achieved) {
        note("weakZone");
        continue;
      }
      if (params.requireAchieved === "ny" && ev.nyCaution) {
        note("weakZone");
        continue;
      }
      const z = ev.entryZone!;
      // Phase-1 trading-hours rule: entries only inside the chosen window.
      const mins = nyMeta(bar.time).minutes;
      if (
        (params.entryHours === "rth" && (mins < 570 || mins >= 925)) ||
        (params.entryHours === "day" && (mins < 120 || mins >= 925))
      ) {
        note("hours");
        continue;
      }
      const touching = z.type === "demand" ? bar.low <= z.proximal : bar.high >= z.proximal;
      if (!touching) {
        note("noTouch"); // qualified zone in view — waiting for price to reach the proximal
        continue;
      }
      // Phase-5 confirmation-candle entry: the touch bar must reject back in
      // the trade direction (close beyond the proximal, directional body).
      const confirmEntry = params.entryStyle === "confirm";
      if (confirmEntry) {
        const confirmed =
          z.type === "demand"
            ? bar.close > z.proximal && bar.close > bar.open
            : bar.close < z.proximal && bar.close < bar.open;
        if (!confirmed) {
          note("noConfirm");
          continue;
        }
      }
      if (Number(params.minScore) > 0 && (ev.score ?? 0) < Number(params.minScore)) {
        note("belowMinScore");
        continue;
      }
      let speed: string | undefined;
      let interDetail = "single-market run — intermarket check skipped";
      if (useIntermarket) {
        const other = ctx.symbols.find((s) => s !== symbol)!;
        const recent = bars.slice(Math.max(0, index - 6), index + 1);
        const inter = intermarketCheck(ev, evals[other]?.ev ?? null, other, recent);
        if (!inter.pass) {
          note("intermarket");
          continue;
        }
        speed = inter.speed;
        interDetail = inter.detail;
        // Second-zone rule (§ intermarket notes): on a fast approach, when the
        // sibling market has its own qualified zone that price has NOT yet
        // reached, this market is the FIRST zone tested — it fails ~90% of the
        // time. Skip it and wait for the second market to reach its zone.
        if (params.secondZone === true && speed === "fast") {
          const oe = evals[other];
          const o = oe?.ev;
          if (o && !o.bucket && o.entryZone) {
            const oz = o.entryZone;
            const ob = oe!.bar;
            const reached =
              (oz.type === "demand" ? ob.low <= oz.proximal : ob.high >= oz.proximal) ||
              (oz.firstReturnAt !== null && oz.firstReturnAt <= ob.time + 300);
            if (!reached) {
              note("firstZone");
              continue;
            }
          }
        }
      }
      // Phase-7 target: dollar band (default), next opposing zone, or fixed R.
      // The zone target needs at least 1R of room; otherwise fall back to the
      // dollar band so a nearby opposing zone can't produce a sub-risk target.
      let target: EntrySignal["target"] = { kind: "netDollar", amount: Number(params.targetNet) };
      if (params.targetMode === "r2") target = { kind: "rMultiple", r: 2 };
      else if (params.targetMode === "r3") target = { kind: "rMultiple", r: 3 };
      else if (params.targetMode === "zone" && ev.opposing && ev.plan!.stopPoints > 0) {
        const margin = Math.abs(ev.opposing.proximal - ev.plan!.entry);
        if (margin >= ev.plan!.stopPoints) target = { kind: "price", price: ev.opposing.proximal };
      }
      signals.push({
        symbol,
        side: ev.plan!.side,
        stop: ev.plan!.stop,
        // Confirmation entries fill at the NEXT bar's open (market after the
        // rejection close); limit entries rest at the zone line and fill on
        // the touch bar itself.
        limit: confirmEntry ? undefined : z.proximal,
        target,
        score: ev.score ?? undefined,
        rank: speed === "fast" && symbol === "MES" ? 1 : 0,
        tags: {
          pattern: z.pattern,
          entryTf: TF_LABEL[ev.entryTf as Timeframe],
          intermarket: interDetail,
        },
      });
    }
    return signals;
  },

  /* Phase-8 trade management, tighten-only and from completed bars only:
     breakeven moves the stop to entry after `breakevenR` × risk in profit;
     the trailing stop then follows `trailR` × risk behind each new close.
     The engine ignores any stop that would widen risk. */
  adjustStop(ctx, snap, pos, params) {
    const be = Number(params.breakevenR);
    const tr = Number(params.trailR);
    if ((!be || be <= 0) && (!tr || tr <= 0)) return null;
    const vis = snap.bySymbol[pos.symbol];
    if (!vis || vis.index < 1) return null;
    const prev = vis.bars[vis.index - 1];
    if (prev.time <= pos.openedAt) return null; // need a completed bar after entry
    const point = pos.symbol === "MES" ? 5 : 2;
    const stopPts = Math.max(1e-9, (pos.risk / pos.qty - ctx.execution.cost) / point);
    const favorable = pos.side === "LONG" ? prev.close - pos.entry : pos.entry - prev.close;
    let stop: number | null = null;
    if (be && isFinite(be) && be > 0 && favorable >= be * stopPts) stop = pos.entry;
    if (tr && isFinite(tr) && tr > 0 && favorable >= tr * stopPts) {
      const trailed = pos.side === "LONG" ? prev.close - tr * stopPts : prev.close + tr * stopPts;
      if (stop === null || (pos.side === "LONG" ? trailed > stop : trailed < stop)) stop = trailed;
    }
    return stop;
  },

  liveReadout(ctx, snap, params): ReadoutRow[] {
    const evals = evaluateVisible(ctx, snap, params);
    const rows: ReadoutRow[] = [];
    for (const symbol of ctx.symbols) {
      const v = evals[symbol];
      if (!v) continue;
      const { ev } = v;
      if (ev.bucket) {
        rows.push({ label: `${symbol} setup`, value: ev.detail, tone: "dim" });
        continue;
      }
      rows.push({
        label: `${symbol} setup`,
        value: `${ev.plan!.side} · ${ev.detail} · score ${ev.score}`,
        tone: ev.atEntry ? "good" : "warn",
      });
      rows.push({
        label: `${symbol} plan`,
        value: `entry ${ev.plan!.entry.toFixed(2)} · stop ${ev.plan!.stop.toFixed(2)} · target ${ev.plan!.target?.toFixed(2)} · ${ev.plan!.qty} contract(s)`,
        tone: "dim",
      });
    }
    return rows;
  },
};
