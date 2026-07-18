/* Test-only oracle: the portfolio walker from legacy/outcomes.js, extracted
   verbatim (rendering removed, globals turned into parameters). Used to prove
   the unified backtest engine reproduces the legacy study's trade list. */

const OUTCOME_CONFIG = {
  startingCapital: 2000,
  targetNet: 162.5,
  dailyLoss: 320,
  maxTrades: 3,
  maxLosses: 2,
  maxDrawdown: 400,
  maxRisk: 160,
  cost: 2.4,
  slippage: 0.25,
};

function freshFunnel() {
  return {
    evaluated: 0,
    noHtf: 0,
    nesting: 0,
    notFresh: 0,
    blocked80: 0,
    weakZone: 0,
    nyCaution: 0,
    refined15: 0,
    riskUnfit: 0,
    intermarket: 0,
    news: 0,
    lock: 0,
    qualified: 0,
  };
}
const BUCKET_TO_FUNNEL = {
  noHtf: "noHtf",
  nesting: "nesting",
  notFresh: "notFresh",
  blocked80: "blocked80",
  weakZone: "weakZone",
  riskUnfit: "riskUnfit",
};

function runLegacyOutcome(V5, stacks, index, eventTimesSec, days, mode, configOverride) {
  const OUTCOME_CONFIG = { ...module.exports.OUTCOME_CONFIG, ...(configOverride || {}) };
  const outcomePoint = (symbol) => V5.pointValue(symbol);
  const outcomeNewsLocked = (time) =>
    eventTimesSec.some((t) => Math.abs(t - time) <= 30 * 60);

  function closeOutcomeTrade(ctx, bar, reason, exit) {
    const p = ctx.position,
      points = p.side === "LONG" ? exit - p.entry : p.entry - exit,
      pnl = points * outcomePoint(p.symbol) * p.qty - OUTCOME_CONFIG.cost * p.qty,
      r = p.risk ? pnl / p.risk : 0,
      trade = {
        ...p,
        exit,
        exitTime: bar.time,
        pnl,
        r,
        reason,
        durationMinutes: Math.max(5, Math.round((bar.time - p.openedAt) / 60)),
      };
    ctx.trades.push(trade);
    ctx.equity += pnl;
    ctx.peak = Math.max(ctx.peak, ctx.equity);
    ctx.maxDrawdown = Math.max(ctx.maxDrawdown, ctx.peak - ctx.equity);
    ctx.dailyPnl += pnl;
    ctx.dailyTrades++;
    ctx.consecutiveLosses = pnl < 0 ? ctx.consecutiveLosses + 1 : 0;
    ctx.equityPoints.push({ time: bar.time, equity: ctx.equity });
    ctx.position = null;
  }

  const maxTime = Math.min(...["MES", "MNQ"].map((s) => stacks[s].exec.at(-1).time)),
    cutoff = maxTime - days * 86400,
    times = [
      ...new Set(
        ["MES", "MNQ"].flatMap((s) =>
          stacks[s].exec
            .filter((b) => b.time >= cutoff && b.time <= maxTime)
            .map((b) => b.time),
        ),
      ),
    ].sort((a, b) => a - b),
    ctx = {
      position: null,
      pending: null,
      trades: [],
      equity: OUTCOME_CONFIG.startingCapital,
      peak: OUTCOME_CONFIG.startingCapital,
      maxDrawdown: 0,
      dailyPnl: 0,
      dailyTrades: 0,
      currentDate: null,
      consecutiveLosses: 0,
      equityPoints: [{ time: cutoff, equity: OUTCOME_CONFIG.startingCapital }],
      funnel: freshFunnel(),
      sessions: new Set(),
    };
  const evalCfg = {
    freshGraceSec: 300,
    targetNet: OUTCOME_CONFIG.targetNet,
    maxRisk: OUTCOME_CONFIG.maxRisk,
    cost: OUTCOME_CONFIG.cost,
    slippage: OUTCOME_CONFIG.slippage,
  };
  for (const time of times) {
    const visible = {};
    for (const symbol of ["MES", "MNQ"]) {
      const idx = index[symbol].get(time);
      if (idx !== undefined) visible[symbol] = { idx, bar: stacks[symbol].exec[idx] };
    }
    const any = visible.MES || visible.MNQ;
    if (!any) continue;
    const date = V5.nyMeta(any.bar.time).date;
    ctx.sessions.add(date);
    if (ctx.currentDate !== date) {
      ctx.currentDate = date;
      ctx.dailyPnl = 0;
      ctx.dailyTrades = 0;
      ctx.consecutiveLosses = 0;
    }
    if (ctx.position) {
      const v = visible[ctx.position.symbol];
      if (v && v.bar.time >= ctx.position.openedAt) {
        const b = v.bar,
          p = ctx.position,
          stopHit = p.side === "LONG" ? b.low <= p.stop : b.high >= p.stop,
          targetHit = p.side === "LONG" ? b.high >= p.target : b.low <= p.target;
        if (stopHit) closeOutcomeTrade(ctx, b, "STOP", p.stop);
        else if (targetHit) closeOutcomeTrade(ctx, b, "TARGET", p.target);
        else if (V5.nyMeta(b.time).minutes >= 925)
          closeOutcomeTrade(ctx, b, "SESSION", b.close);
      }
    }
    if (!ctx.position && ctx.pending && time >= ctx.pending.executeTime) {
      const plan = ctx.pending,
        v = visible[plan.symbol];
      ctx.pending = null;
      if (v && V5.nyMeta(v.bar.time).date === plan.date) {
        const point = outcomePoint(plan.symbol),
          entry =
            plan.side === "LONG"
              ? v.bar.open + OUTCOME_CONFIG.slippage
              : v.bar.open - OUTCOME_CONFIG.slippage,
          stop = plan.stop,
          per = Math.abs(entry - stop) * point + OUTCOME_CONFIG.cost,
          qty = Math.floor(OUTCOME_CONFIG.maxRisk / per);
        if (qty > 0) {
          const targetPoints =
            (OUTCOME_CONFIG.targetNet + OUTCOME_CONFIG.cost * qty) / (point * qty);
          ctx.position = {
            symbol: plan.symbol,
            side: plan.side,
            score: plan.score,
            pattern: plan.pattern,
            entryTf: plan.entryTf,
            entry,
            stop,
            target:
              plan.side === "LONG" ? entry + targetPoints : entry - targetPoints,
            qty,
            risk: per * qty,
            riskPerContract: per,
            openedAt: v.bar.time,
            intermarket: plan.intermarket,
          };
        } else ctx.funnel.riskUnfit++;
      }
    }
    if (ctx.position || ctx.pending) continue;

    const evals = {};
    for (const [symbol, v] of Object.entries(visible))
      evals[symbol] = V5.evaluate(stacks[symbol], {
        symbol,
        time: v.bar.time + 300,
        price: v.bar.close,
        mode,
        config: evalCfg,
      });

    const candidates = [];
    for (const [symbol, v] of Object.entries(visible)) {
      const ev = evals[symbol],
        bar = v.bar;
      ctx.funnel.evaluated++;
      if (ev.bucket) {
        ctx.funnel[BUCKET_TO_FUNNEL[ev.bucket] || "nesting"]++;
        continue;
      }
      if (ev.refined15) ctx.funnel.refined15++;
      if (ev.nyCaution) ctx.funnel.nyCaution++;
      const z = ev.entryZone,
        touching =
          z.type === "demand" ? bar.low <= z.proximal : bar.high >= z.proximal;
      if (!touching) continue;
      const other = symbol === "MES" ? "MNQ" : "MES",
        recent = stacks[symbol].exec.slice(Math.max(0, v.idx - 6), v.idx + 1),
        inter = V5.intermarketCheck(ev, evals[other], other, recent);
      if (!inter.pass) {
        ctx.funnel.intermarket++;
        continue;
      }
      if (outcomeNewsLocked(time)) {
        ctx.funnel.news++;
        continue;
      }
      const locked =
        ctx.dailyPnl <= -OUTCOME_CONFIG.dailyLoss ||
        ctx.dailyTrades >= OUTCOME_CONFIG.maxTrades ||
        ctx.consecutiveLosses >= OUTCOME_CONFIG.maxLosses ||
        ctx.maxDrawdown >= OUTCOME_CONFIG.maxDrawdown;
      if (locked) {
        ctx.funnel.lock++;
        continue;
      }
      const next = stacks[symbol].exec[v.idx + 1];
      if (!next || V5.nyMeta(next.time).date !== date) {
        ctx.funnel.lock++;
        continue;
      }
      ctx.funnel.qualified++;
      candidates.push({
        symbol,
        side: ev.plan.side,
        score: ev.score,
        pattern: z.pattern,
        entryTf: V5.TF_LABEL[ev.entryTf],
        stop: ev.plan.stop,
        intermarket: inter.detail,
        speed: inter.speed,
        executeTime: next.time,
        date,
      });
    }
    if (candidates.length) {
      candidates.sort(
        (a, b) =>
          (a.speed === "fast" && a.symbol === "MES" ? -1 : 0) -
            (b.speed === "fast" && b.symbol === "MES" ? -1 : 0) ||
          b.score - a.score ||
          (a.symbol === "MES" ? -1 : 1),
      );
      ctx.pending = candidates[0];
    }
  }
  if (ctx.position) {
    const exec = stacks[ctx.position.symbol].exec,
      bar = [...exec].reverse().find((b) => b.time <= maxTime);
    if (bar) closeOutcomeTrade(ctx, bar, "WINDOW END", bar.close);
  }
  ctx.equityPoints.push({ time: maxTime, equity: ctx.equity });
  return ctx;
}

module.exports = { runLegacyOutcome, OUTCOME_CONFIG };
