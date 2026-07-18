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
      }
      signals.push({
        symbol,
        side: ev.plan!.side,
        stop: ev.plan!.stop,
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
