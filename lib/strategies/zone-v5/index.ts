/* Strategy v5 (demand & supply zone engine) wrapped in the generic strategy
   contract. The candidate flow mirrors legacy/outcomes.js runOutcome():
   evaluate each market on the completed bar, require a proximal touch,
   confirm intermarket agreement, prefer the MES zone on fast approaches. */

import type { Bar } from "@/lib/types";
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
    "Institutional demand & supply zones (DBR/RBR/RBD/DBD) with Daily→4H→1H alignment, freshness, the 80% rule and MES/MNQ intermarket confirmation. Enters on the first return into a fresh zone. Directional alignment by default; switch to Strict for full rectangle nesting.",
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
  ],

  prepare(series, _params, execution) {
    const symbols = Object.keys(series).sort(); // MES before MNQ
    const stacks: Record<string, Stack> = {};
    for (const s of symbols) stacks[s] = buildStack(series[s]);
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
      const touching = z.type === "demand" ? bar.low <= z.proximal : bar.high >= z.proximal;
      if (!touching) continue;
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
      signals.push({
        symbol,
        side: ev.plan!.side,
        stop: ev.plan!.stop,
        limit: z.proximal, // resting order at the zone line — fills on the touch bar in limit mode

        target: { kind: "netDollar", amount: Number(params.targetNet) },
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

  /* Phase-8 trade management: move the stop to breakeven once the previous
     COMPLETED bar closes `breakevenR` × initial risk in profit. Uses only
     completed-bar information; the engine applies it tighten-only. */
  adjustStop(ctx, snap, pos, params) {
    const r = Number(params.breakevenR);
    if (!r || !isFinite(r) || r <= 0) return null;
    const vis = snap.bySymbol[pos.symbol];
    if (!vis || vis.index < 1) return null;
    const prev = vis.bars[vis.index - 1];
    if (prev.time <= pos.openedAt) return null; // need a completed bar after entry
    const point = pos.symbol === "MES" ? 5 : 2;
    const stopPts = Math.max(1e-9, (pos.risk / pos.qty - ctx.execution.cost) / point);
    const favorable = pos.side === "LONG" ? prev.close - pos.entry : pos.entry - prev.close;
    if (favorable >= r * stopPts) return pos.entry;
    return null;
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
