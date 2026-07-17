const OUTCOME_WINDOWS = [30, 40, 60];
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
const outcomeState = {
  days: 60,
  data: {},
  stacks: {},
  index: {},
  runs: {},
  events: [],
  loading: false,
};

function outcomePoint(symbol) {
  return V5.pointValue(symbol);
}
function outcomeMoney(value) {
  return `${value >= 0 ? "+" : ""}$${fmt(value)}`;
}
function outcomeClass(value) {
  return value >= 0 ? "positive" : "negative";
}
function outcomeNewsLocked(time) {
  return outcomeState.events.some(
    (e) => Math.abs(new Date(e.time).getTime() / 1000 - time) <= 30 * 60,
  );
}
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

/* Portfolio walk over the union MES/MNQ 5m timeline under v5 rules.
   mode: "strict" (v5 rectangle nesting) or "directional" (labelled v4
   comparison run — same-side agreement instead of containment). */
function runOutcome(days, mode) {
  const maxTime = Math.min(
      ...["MES", "MNQ"].map((s) => outcomeState.stacks[s].exec.at(-1).time),
    ),
    cutoff = maxTime - days * 86400,
    times = [
      ...new Set(
        ["MES", "MNQ"].flatMap((s) =>
          outcomeState.stacks[s].exec
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
      const idx = outcomeState.index[symbol].get(time);
      if (idx !== undefined)
        visible[symbol] = { idx, bar: outcomeState.stacks[symbol].exec[idx] };
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
          targetHit =
            p.side === "LONG" ? b.high >= p.target : b.low <= p.target;
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
            (OUTCOME_CONFIG.targetNet + OUTCOME_CONFIG.cost * qty) /
            (point * qty);
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
      evals[symbol] = V5.evaluate(outcomeState.stacks[symbol], {
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
      // Diagnostic buckets (§9.7) — counted, not exclusions in strict mode.
      if (ev.refined15) ctx.funnel.refined15++;
      if (ev.nyCaution) ctx.funnel.nyCaution++;
      // §3.1: entries only during the zone's FIRST visit (evaluate() has
      // already excluded zones whose first visit is over).
      const z = ev.entryZone,
        touching =
          z.type === "demand" ? bar.low <= z.proximal : bar.high >= z.proximal;
      if (!touching) continue;
      const other = symbol === "MES" ? "MNQ" : "MES",
        recent = outcomeState.stacks[symbol].exec.slice(
          Math.max(0, v.idx - 6),
          v.idx + 1,
        ),
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
      const next = outcomeState.stacks[symbol].exec[v.idx + 1];
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
      // §5.3 — in the fast two-market configuration prefer the MES zone.
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
    const exec = outcomeState.stacks[ctx.position.symbol].exec,
      bar = [...exec].reverse().find((b) => b.time <= maxTime);
    if (bar) closeOutcomeTrade(ctx, bar, "WINDOW END", bar.close);
  }
  ctx.equityPoints.push({ time: maxTime, equity: ctx.equity });
  return summarizeOutcome(ctx, days, mode, cutoff, maxTime);
}

function metricsFromTrades(trades) {
  const wins = trades.filter((t) => t.pnl > 0),
    losses = trades.filter((t) => t.pnl < 0),
    net = trades.reduce((s, t) => s + t.pnl, 0),
    grossWin = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let equity = OUTCOME_CONFIG.startingCapital,
    peak = equity,
    maxDrawdown = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    trades: trades.length,
    net,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    avgR: trades.length
      ? trades.reduce((s, t) => s + t.r, 0) / trades.length
      : 0,
    maxDrawdown,
    expectancy: trades.length ? net / trades.length : 0,
    averageDuration: trades.length
      ? trades.reduce((s, t) => s + t.durationMinutes, 0) / trades.length
      : 0,
    wins: wins.length,
    losses: losses.length,
  };
}
function summarizeOutcome(ctx, days, mode, cutoff, maxTime) {
  const metrics = metricsFromTrades(ctx.trades),
    byInstrument = {};
  for (const s of ["MES", "MNQ"])
    byInstrument[s] = metricsFromTrades(
      ctx.trades.filter((t) => t.symbol === s),
    );
  const buckets = { "≤69": [], "70–84": [], "85–100": [] };
  for (const t of ctx.trades)
    (t.score < 70
      ? buckets["≤69"]
      : t.score < 85
        ? buckets["70–84"]
        : buckets["85–100"]
    ).push(t);
  return {
    days,
    mode,
    cutoff,
    maxTime,
    tradeList: ctx.trades,
    equityPoints: ctx.equityPoints,
    funnel: ctx.funnel,
    sessions: ctx.sessions.size,
    ...metrics,
    byInstrument,
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, metricsFromTrades(v)]),
    ),
  };
}

function renderOutcomeKpis(run) {
  const values = [
    [
      "NET P&L",
      outcomeMoney(run.net),
      `${run.trades} qualified trades`,
      run.net,
    ],
    [
      "WIN RATE",
      `${run.winRate.toFixed(1)}%`,
      `${run.wins} wins · ${run.losses} losses`,
      run.winRate - 50,
    ],
    [
      "PROFIT FACTOR",
      Number.isFinite(run.profitFactor) ? run.profitFactor.toFixed(2) : "∞",
      "Gross profit ÷ gross loss",
      run.profitFactor - 1,
    ],
    [
      "AVERAGE R",
      `${run.avgR.toFixed(2)}R`,
      `$${fmt(run.expectancy)} expectancy`,
      run.avgR,
    ],
    [
      "MAX DRAWDOWN",
      `$${fmt(run.maxDrawdown)}`,
      "Peak-to-trough closed equity",
      -run.maxDrawdown,
    ],
    [
      "AVG DURATION",
      run.trades ? `${Math.round(run.averageDuration)}m` : "—",
      `${run.sessions} NY sessions`,
      0,
    ],
  ];
  $("outcome-kpis").innerHTML = values
    .map(
      ([label, value, note, sentiment]) =>
        `<article class="${sentiment > 0 ? "metric-positive" : sentiment < 0 ? "metric-negative" : ""}"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`,
    )
    .join("");
}
function renderInstrumentCards(run) {
  $("instrument-results").innerHTML = ["MNQ", "MES"]
    .map((symbol) => {
      const m = run.byInstrument[symbol],
        name =
          symbol === "MNQ" ? "Micro E-mini Nasdaq-100" : "Micro E-mini S&P 500",
        color = symbol === "MNQ" ? "#9b8cff" : "#61d7ff";
      return `<article class="instrument-card" style="--instrument-color:${color}"><div class="instrument-top"><div class="instrument-name"><span class="contract-mark">${symbol}</span><div><h2>${name}</h2><span>${symbol === "MNQ" ? "$2" : "$5"} per index point</span></div></div><div class="instrument-pnl"><strong class="${outcomeClass(m.net)}">${outcomeMoney(m.net)}</strong><span>${m.trades} portfolio-selected trades</span></div></div><div class="instrument-metrics"><div><small>WIN RATE</small><b>${m.winRate.toFixed(1)}%</b></div><div><small>PROFIT FACTOR</small><b>${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"}</b></div><div><small>AVERAGE R</small><b>${m.avgR.toFixed(2)}R</b></div><div><small>MAX DD</small><b>$${fmt(m.maxDrawdown)}</b></div><div><small>EXPECTANCY</small><b class="${outcomeClass(m.expectancy)}">${outcomeMoney(m.expectancy)}</b></div></div></article>`;
    })
    .join("");
}

function linePath(points, x, y) {
  return points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(p.equity).toFixed(1)}`,
    )
    .join(" ");
}
function renderEquityChart(strict, base) {
  const all = [...strict.equityPoints, ...base.equityPoints],
    width = 900,
    height = 270,
    pad = { l: 54, r: 16, t: 14, b: 28 },
    minT = Math.min(...all.map((p) => p.time)),
    maxT = Math.max(...all.map((p) => p.time)),
    rawMin = Math.min(...all.map((p) => p.equity)),
    rawMax = Math.max(...all.map((p) => p.equity)),
    spread = Math.max(40, rawMax - rawMin),
    minY = rawMin - spread * 0.14,
    maxY = rawMax + spread * 0.14,
    x = (t) =>
      pad.l + ((t - minT) / (maxT - minT || 1)) * (width - pad.l - pad.r),
    y = (v) =>
      pad.t + ((maxY - v) / (maxY - minY || 1)) * (height - pad.t - pad.b),
    strictPath = linePath(strict.equityPoints, x, y),
    basePath = linePath(base.equityPoints, x, y),
    area = `${strictPath} L${x(strict.equityPoints.at(-1).time).toFixed(1)},${y(minY).toFixed(1)} L${x(strict.equityPoints[0].time).toFixed(1)},${y(minY).toFixed(1)} Z`,
    grid = Array.from({ length: 5 }, (_, i) => {
      const value = maxY - ((maxY - minY) * i) / 4,
        yy = y(value);
      return `<line class="chart-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${yy}" y2="${yy}"/><text class="chart-axis" x="4" y="${yy + 3}">$${Math.round(value).toLocaleString()}</text>`;
    }).join("");
  $("equity-chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Portfolio equity curve"><defs><linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#43d5a5" stop-opacity=".18"/><stop offset="1" stop-color="#43d5a5" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${area}"/><path class="chart-base" d="${basePath}"/><path class="chart-strict" d="${strictPath}"/><text class="chart-axis" x="${pad.l}" y="${height - 7}">${new Date(minT * 1000).toLocaleDateString()}</text><text class="chart-axis" text-anchor="end" x="${width - pad.r}" y="${height - 7}">${new Date(maxT * 1000).toLocaleDateString()}</text></svg>`;
}

function renderVerdict(run) {
  const positives = OUTCOME_WINDOWS.filter(
      (d) => outcomeState.runs[d].strict.net > 0,
    ).length,
    pfWindows = OUTCOME_WINDOWS.filter(
      (d) => outcomeState.runs[d].strict.profitFactor > 1,
    ).length,
    sample = run.trades >= 30,
    positive = run.net > 0 && run.avgR > 0,
    label = !sample
      ? "INSUFFICIENT SAMPLE"
      : positives === 3 && pfWindows === 3
        ? "CONSISTENT SAMPLE"
        : positive
          ? "POSITIVE / FRAGILE"
          : "NEGATIVE SAMPLE",
    badge = !sample ? "amber" : positive ? "green" : "red",
    copy = !sample
      ? "Strict v5 nesting is deliberately selective, and this window produced too few qualified trades to treat as dependable evidence. The funnel shows exactly where candidates were rejected."
      : positives === 3 && pfWindows === 3
        ? "The v5 rule interpretation remained profitable across all three rolling windows. It still requires licensed tick data and walk-forward validation."
        : positive
          ? "The selected window is positive, but the result does not persist cleanly across every period."
          : "The v5 rule interpretation did not produce positive expectancy in this window.";
  $("outcome-verdict").innerHTML =
    `<div class="panel-head"><div><h2>ROBUSTNESS READ</h2><small>Evidence across rolling windows</small></div><span class="badge ${badge}">${label}</span></div><div class="verdict-hero"><strong>${copy}</strong><p>This is a deterministic historical calculation, not an AI prediction or a guarantee of future performance.</p></div><div class="verdict-list"><div><span>Positive windows</span><b>${positives} / 3</b></div><div><span>Profit factor above 1</span><b>${pfWindows} / 3</b></div><div><span>Qualified sample</span><b>${run.trades} trades</b></div><div><span>Capital drawdown</span><b>${((run.maxDrawdown / OUTCOME_CONFIG.startingCapital) * 100).toFixed(1)}%</b></div></div>`;
}

function renderFunnel(run) {
  const labels = [
      ["Evaluated 5m candles", "evaluated", ""],
      ["No HTF zone in range", "noHtf", ""],
      ["Nesting containment failed", "nesting", ""],
      ["Zone not fresh — first return only", "notFresh", ""],
      ["80% rule block", "blocked80", ""],
      ["Weak-zone exclusion (v4 mode only)", "weakZone", ""],
      ["NY 1H caution", "nyCaution", "diag"],
      ["Risk-fit refined to 15M", "refined15", "diag"],
      ["Risk unfit ($160 cap)", "riskUnfit", ""],
      ["Intermarket disagreement", "intermarket", ""],
      ["News lockout", "news", ""],
      ["Discipline locks", "lock", ""],
      ["Qualified entries", "qualified", "good"],
    ],
    max = Math.max(1, run.funnel.evaluated);
  $("rule-funnel").innerHTML = labels
    .map(
      ([label, key, kind]) =>
        `<div class="funnel-row ${kind}"><span>${label}${kind === "diag" ? '<i class="diag-mark">diagnostic</i>' : ""}</span><div class="funnel-track"><i style="width:${Math.max(0.5, (run.funnel[key] / max) * 100)}%"></i></div><b>${run.funnel[key].toLocaleString()}</b></div>`,
    )
    .join("");
}
function renderAlignmentImpact(strict, base) {
  const netDelta = strict.net - base.net,
    ddDelta = strict.maxDrawdown - base.maxDrawdown,
    helped = netDelta > 0 && ddDelta <= 0;
  $("intermarket-impact").innerHTML =
    `<div class="impact-score"><div class="impact-side"><small>STRICT NESTING · v5</small><strong class="${outcomeClass(strict.net)}">${outcomeMoney(strict.net)}</strong><span>${strict.trades} trades · $${fmt(strict.maxDrawdown)} DD</span></div><span class="impact-arrow">→</span><div class="impact-side"><small>DIRECTIONAL · v4 COMPARISON</small><strong class="${outcomeClass(base.net)}">${outcomeMoney(base.net)}</strong><span>${base.trades} trades · $${fmt(base.maxDrawdown)} DD</span></div></div><div class="impact-summary"><b>${helped ? "Strict containment improved this sample." : "No confirmed improvement from strict containment in this sample."}</b><br>Net difference ${outcomeMoney(netDelta)}; drawdown difference ${outcomeMoney(ddDelta)}. The directional engine is retained only as a labelled comparison run, not as a tradeable default.</div>`;
}
function renderWindowMatrix() {
  const selected = outcomeState.days;
  $("window-matrix").innerHTML = OUTCOME_WINDOWS.map((days) => {
    const r = outcomeState.runs[days].strict,
      good = r.net > 0 && r.profitFactor > 1;
    return `<tr class="${days === selected ? "selected" : ""}"><td><b>${days} days</b></td><td>${r.sessions}</td><td>${r.trades}</td><td class="${outcomeClass(r.net)}">${outcomeMoney(r.net)}</td><td>${r.winRate.toFixed(1)}%</td><td>${Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞"}</td><td>${r.avgR.toFixed(2)}R</td><td>$${fmt(r.maxDrawdown)}</td><td><span class="outcome-chip ${r.trades === 0 ? "" : good ? "positive" : "negative"}">${r.trades === 0 ? "NO QUALIFIED TRADES" : r.trades < 20 ? "SMALL SAMPLE" : good ? "POSITIVE" : "NEGATIVE"}</span></td></tr>`;
  }).join("");
}
function renderBuckets(run) {
  $("score-buckets").innerHTML = Object.entries(run.buckets)
    .map(
      ([label, m]) =>
        `<div class="bucket"><small>SCORE ${label}</small><strong class="${outcomeClass(m.net)}">${outcomeMoney(m.net)}</strong><span>${m.trades} trades · ${m.winRate.toFixed(1)}% win rate<br>${m.avgR.toFixed(2)}R average · PF ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"}</span></div>`,
    )
    .join("");
}
function renderTradeLedger(run) {
  $("trade-ledger-subtitle").textContent =
    `${run.days}-day window · ${run.trades} completed trades · newest first`;
  $("outcome-trade-body").innerHTML = run.tradeList.length
    ? [...run.tradeList]
        .reverse()
        .slice(0, 30)
        .map(
          (t) =>
            `<tr><td>${new Date(t.openedAt * 1000).toLocaleString()}</td><td><b>${t.symbol}</b><small class="cell-note">${t.entryTf || ""} ${t.pattern || ""}</small></td><td>${t.side}</td><td>${t.score ?? "—"}</td><td>${fmt(t.entry)}</td><td>${fmt(t.stop)}</td><td>${fmt(t.target)}</td><td>${t.qty}</td><td>$${fmt(t.risk)}</td><td>${t.reason}</td><td class="${outcomeClass(t.pnl)}">${outcomeMoney(t.pnl)}</td><td>${t.r.toFixed(2)}R</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="12" class="empty">No setup passed every v5 rule in this window — see the qualification funnel for where candidates were rejected.</td></tr>';
}

function renderOutcomes() {
  const pair = outcomeState.runs[outcomeState.days];
  if (!pair) return;
  document.querySelectorAll("[data-outcome-days]").forEach((b) => {
    const selected = Number(b.dataset.outcomeDays) === outcomeState.days;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  $("outcome-selected").textContent = `Last ${outcomeState.days} days`;
  const strict = pair.strict,
    base = pair.base;
  renderOutcomeKpis(strict);
  renderInstrumentCards(strict);
  renderEquityChart(strict, base);
  renderVerdict(strict);
  renderFunnel(strict);
  renderAlignmentImpact(strict, base);
  renderWindowMatrix();
  renderBuckets(strict);
  renderTradeLedger(strict);
  $("outcome-status").textContent =
    `${outcomeState.days}-day v5 outcome ready · ${strict.sessions} New York sessions`;
  $("outcome-provenance").textContent =
    `${outcomeState.data.MES.source} · refreshed ${new Date(outcomeState.data.MES.fetchedAt).toLocaleString()}`;
}

async function loadOutcomes() {
  if (outcomeState.loading) return;
  outcomeState.loading = true;
  $("outcome-status").textContent = "Loading 60-day MNQ and MES history…";
  $("outcome-refresh").disabled = true;
  try {
    const [mes, mnq, eventData] = await Promise.all(
      [
        fetch("/api/history?symbol=MES"),
        fetch("/api/history?symbol=MNQ"),
        fetch("/api/events"),
      ].map(async (p) => {
        const r = await p;
        if (!r.ok)
          throw new Error(
            (await r.json()).error || "Historical source unavailable",
          );
        return r.json();
      }),
    );
    outcomeState.data = { MES: mes, MNQ: mnq };
    outcomeState.events = eventData.events || [];
    $("outcome-status").textContent =
      "Building v5 zone stacks (patterns, nesting, 80% rule)…";
    await new Promise(requestAnimationFrame);
    for (const s of ["MES", "MNQ"]) {
      outcomeState.stacks[s] = V5.buildStack(outcomeState.data[s].bars);
      outcomeState.index[s] = new Map(
        outcomeState.stacks[s].exec.map((b, i) => [b.time, i]),
      );
    }
    for (const days of OUTCOME_WINDOWS) {
      outcomeState.runs[days] = {
        strict: runOutcome(days, "strict"),
        base: runOutcome(days, "directional"),
      };
    }
    renderOutcomes();
  } catch (error) {
    $("outcome-status").textContent = "Historical analysis unavailable";
    $("outcome-provenance").textContent = error.message;
    $("outcome-kpis").innerHTML =
      `<article class="metric-negative" style="grid-column:1/-1"><small>DATA ERROR</small><strong>Analysis paused</strong><span>${error.message}. No outcome values were invented.</span></article>`;
    $("instrument-results").innerHTML = "";
  } finally {
    outcomeState.loading = false;
    $("outcome-refresh").disabled = false;
  }
}

document.querySelectorAll("[data-outcome-days]").forEach((button) =>
  button.addEventListener("click", () => {
    outcomeState.days = Number(button.dataset.outcomeDays);
    renderOutcomes();
  }),
);
$("outcome-refresh").addEventListener("click", loadOutcomes);
$("outcome-details-toggle").addEventListener("click", (event) => {
  const page = $("outcomes"),
    open = page.classList.toggle("show-advanced");
  event.currentTarget.setAttribute("aria-expanded", String(open));
  event.currentTarget.textContent = open
    ? "Hide detailed analysis ↑"
    : "Show detailed rules and trade ledger ↓";
});
$("outcome-export").addEventListener("click", () => {
  const run = outcomeState.runs[outcomeState.days]?.strict;
  if (!run?.tradeList.length) return;
  const head =
      "opened,exit,instrument,entry_timeframe,pattern,side,score,entry,stop,target,quantity,risk,pnl,r_multiple,reason",
    rows = run.tradeList.map((t) =>
      [
        new Date(t.openedAt * 1000).toISOString(),
        new Date(t.exitTime * 1000).toISOString(),
        t.symbol,
        t.entryTf || "",
        t.pattern || "",
        t.side,
        t.score,
        t.entry,
        t.stop,
        t.target,
        t.qty,
        t.risk,
        t.pnl,
        t.r,
        t.reason,
      ].join(","),
    ),
    blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `aegis-v5-${outcomeState.days}d-strategy-outcomes.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});
loadOutcomes();
