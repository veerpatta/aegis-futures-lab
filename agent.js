const AGENT_KEY = "aegis-paper-agent-v3";
const emptyArrivals = () => ({
  LONG: { MES: null, MNQ: null },
  SHORT: { MES: null, MNQ: null },
});
const agentDefaults = () => ({
  armed: false,
  startingCapital: 2000,
  peakEquity: 2000,
  realizedPnl: 0,
  position: null,
  trades: [],
  logs: [],
  lastBar: {},
  arrivals: emptyArrivals(),
  config: {
    minScore: 80,
    rr: 2,
    tolerance: 0.6,
    dailyLoss: 320,
    maxTrades: 3,
    maxLosses: 2,
    maxDrawdown: 400,
    maxRisk: 160,
    cost: 2.4,
    slippage: 0.25,
    intermarket: true,
    maxLagMinutes: 30,
  },
});
let paper = loadPaper(),
  latestPipeline = [];

function loadPaper() {
  try {
    const base = agentDefaults(),
      saved = JSON.parse(localStorage.getItem(AGENT_KEY) || "{}"),
      loaded = {
        ...base,
        ...saved,
        config: { ...base.config, ...(saved.config || {}) },
        arrivals: saved.arrivals || base.arrivals,
      };
    loaded.config.maxRisk = Math.min(
      160,
      Math.max(0, Number(loaded.config.maxRisk) || 160),
    );
    loaded.peakEquity = Math.max(
      Number(loaded.peakEquity) || base.startingCapital,
      base.startingCapital + Number(loaded.realizedPnl || 0),
    );
    return loaded;
  } catch (e) {
    return agentDefaults();
  }
}
function savePaper() {
  localStorage.setItem(AGENT_KEY, JSON.stringify(paper));
  renderPaper();
  if (state.analysis) renderAnalysis(state.analysis);
}
function nyKey(time = Date.now() / 1000) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time * 1000));
}
function inNYSession(time) {
  const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(time * 1000))
      .reduce((a, p) => ((a[p.type] = p.value), a), {}),
    mins = (+parts.hour % 24) * 60 + +parts.minute;
  return !["Sat", "Sun"].includes(parts.weekday) && mins >= 570 && mins < 930;
}
function todayTrades(time = Date.now() / 1000) {
  const key = nyKey(time);
  return paper.trades.filter((t) => nyKey(t.exitTime) === key);
}
function consecutiveLosses(trades = paper.trades) {
  let n = 0;
  for (let i = trades.length - 1; i >= 0 && trades[i].pnl < 0; i--) n++;
  return n;
}
function accountDrawdown() {
  return Math.max(
    0,
    paper.peakEquity - (paper.startingCapital + paper.realizedPnl),
  );
}
function logAgent(title, detail, type = "info", time = Date.now() / 1000) {
  paper.logs.unshift({ title, detail, type, time });
  paper.logs = paper.logs.slice(0, 80);
}
function newsLocked(time) {
  return state.events.some(
    (e) => Math.abs(new Date(e.time).getTime() - time * 1000) <= 30 * 60 * 1000,
  );
}
function pointValue(symbol) {
  return symbol === "MES" ? 5 : 2;
}
function pipelineRow(name, pass, detail) {
  return { name, pass, detail };
}
function snapshot(symbol) {
  const bars = getBars(symbol),
    a = analyzeStrategy(bars);
  if (!a) return null;
  const longZone =
      a.last.close <= a.demand.high + a.atr * paper.config.tolerance,
    shortZone = a.last.close >= a.supply.low - a.atr * paper.config.tolerance;
  return {
    symbol,
    bars,
    a,
    longZone,
    shortZone,
    longReady: a.trend === "UPTREND" && longZone && a.last.close > a.last.open,
    shortReady:
      a.trend === "DOWNTREND" && shortZone && a.last.close < a.last.open,
  };
}

function recordArrivals(snapshots) {
  for (const side of ["LONG", "SHORT"])
    for (const symbol of ["MES", "MNQ"]) {
      const snap = snapshots[symbol];
      if (!snap) continue;
      const atZone = side === "LONG" ? snap.longZone : snap.shortZone,
        current = paper.arrivals[side][symbol];
      if (atZone && !current) paper.arrivals[side][symbol] = snap.a.last.time;
      if (
        !atZone &&
        current &&
        snap.a.last.time - current > paper.config.maxLagMinutes * 60
      )
        paper.arrivals[side][symbol] = null;
    }
}
function intermarketGate(symbol, side) {
  if (!paper.config.intermarket || state.mode === "REPLAY")
    return {
      pass: true,
      detail:
        state.mode === "REPLAY"
          ? "Single-instrument replay: intermarket comparison not available"
          : "Intermarket filter disabled",
    };
  const other = symbol === "MES" ? "MNQ" : "MES",
    mine = paper.arrivals[side][symbol],
    theirs = paper.arrivals[side][other];
  if (!mine)
    return {
      pass: false,
      detail: `${symbol} has not reached its corresponding ${side === "LONG" ? "demand" : "supply"} zone`,
    };
  if (!theirs)
    return {
      pass: false,
      detail: `${symbol} is first arrival; waiting for ${other} corresponding zone`,
    };
  const lag = Math.abs(mine - theirs),
    max = paper.config.maxLagMinutes * 60;
  if (lag > max) {
    if (mine < theirs) paper.arrivals[side][symbol] = null;
    else paper.arrivals[side][other] = null;
    return {
      pass: false,
      detail: `Arrival lag ${Math.round(lag / 60)}m exceeds ${paper.config.maxLagMinutes}m; sequence reset`,
    };
  }
  if (mine < theirs)
    return {
      pass: false,
      detail: `${symbol} arrived first; higher confidence belongs to ${other} second arrival`,
    };
  if (mine === theirs)
    return {
      pass: true,
      detail: `MES and MNQ reached corresponding zones together`,
    };
  return {
    pass: true,
    detail: `${symbol} is second arrival, ${Math.round(lag / 60)}m after ${other}`,
  };
}

function evaluateAgent(source = "manual") {
  latestPipeline = [];
  if (!paper.armed && source !== "manual") {
    renderPaper();
    return;
  }
  if (paper.position) {
    managePosition();
    renderPaper();
    return;
  }
  const symbols =
      state.mode === "REPLAY"
        ? [state.imported?.symbol].filter(Boolean)
        : ["MES", "MNQ"],
    snapshots = {};
  for (const symbol of symbols) snapshots[symbol] = snapshot(symbol);
  recordArrivals(snapshots);
  let candidate = null,
    firstPipeline = null;
  for (const symbol of symbols) {
    const snap = snapshots[symbol];
    if (!snap) continue;
    const { a } = snap;
    if (paper.lastBar[symbol] === a.last.time && source !== "manual") continue;
    const side = snap.longReady ? "LONG" : snap.shortReady ? "SHORT" : null,
      inter = side
        ? intermarketGate(symbol, side)
        : {
            pass: false,
            detail: "Waiting for a direction-qualified zone return",
          },
      trades = todayTrades(a.last.time),
      dailyPnl = trades.reduce((s, t) => s + t.pnl, 0),
      losses = consecutiveLosses(trades),
      drawdown = accountDrawdown(),
      session = inNYSession(a.last.time),
      fresh = !a.stale || state.mode === "REPLAY",
      enough = a.timeframes.h1 >= 15 && a.timeframes.m5 >= 15,
      calendarReady = state.eventStatus === "READY",
      news = calendarReady && !newsLocked(a.last.time),
      strategy = Boolean(side) && a.score >= paper.config.minScore,
      risk =
        dailyPnl > -paper.config.dailyLoss &&
        trades.length < paper.config.maxTrades &&
        losses < paper.config.maxLosses &&
        drawdown < paper.config.maxDrawdown;
    const rows = [
      pipelineRow(
        "Market agent",
        fresh && session && enough,
        `${a.timeframes.h1}×60m · ${a.timeframes.m5}×5m · ${session ? "NY session" : "outside NY session"} · ${fresh ? "fresh" : "stale"}`,
      ),
      pipelineRow(
        "Strategy agent",
        strategy,
        `${a.trend} 60m bias · 5m score ${a.score} · ${a.zoneReturn ? "zone return" : "waiting for zone"} · ${a.confirmation ? "1m confirmed" : "waiting 1m confirmation"}`,
      ),
      pipelineRow("Intermarket guardian", inter.pass, inter.detail),
      pipelineRow(
        "News guardian",
        news,
        !calendarReady
          ? "Calendar unavailable; fail-safe lock"
          : news
            ? "No scheduled event inside ±30m"
            : "High-impact lockout",
      ),
      pipelineRow(
        "Risk guardian",
        risk,
        `Daily $${fmt(dailyPnl)} · ${trades.length}/${paper.config.maxTrades} trades · ${losses}/${paper.config.maxLosses} losses · $${fmt(drawdown)} peak drawdown`,
      ),
      pipelineRow("Paper executor", false, "Awaiting all gates"),
    ];
    if (!firstPipeline) firstPipeline = rows;
    if (rows.slice(0, 5).every((x) => x.pass)) {
      candidate = { symbol, a, side, rows };
      break;
    }
    paper.lastBar[symbol] = a.last.time;
  }
  latestPipeline = candidate
    ? candidate.rows
    : firstPipeline || [
        pipelineRow(
          "Market agent",
          false,
          "Insufficient validated candle history",
        ),
        pipelineRow("Strategy agent", false, "Waiting for 60m/5m/1m data"),
        pipelineRow("Intermarket guardian", false, "Waiting for MES and MNQ"),
        pipelineRow("News guardian", true, "No active lockout"),
        pipelineRow("Risk guardian", true, "Risk limits ready"),
        pipelineRow("Paper executor", false, "Awaiting all gates"),
      ];
  if (!candidate) {
    const failure = latestPipeline.find((x) => !x.pass);
    logAgent(
      "Agent waiting",
      failure?.detail || "No new validated candle",
      "blocked",
    );
    savePaper();
    return;
  }
  if (!paper.armed) {
    latestPipeline[5] = pipelineRow(
      "Paper executor",
      false,
      "Candidate found, but paper agent is switched off",
    );
    logAgent(
      "Candidate only",
      latestPipeline[5].detail,
      "info",
      candidate.a.last.time,
    );
    savePaper();
    return;
  }
  openPaperPosition(candidate);
  savePaper();
}

function openPaperPosition({ symbol, a, side }) {
  const point = pointValue(symbol),
    hardBudget = Math.min(
      160,
      Math.max(0, Number(paper.config.maxRisk) || 160),
    ),
    raw = a.last.close,
    entry =
      side === "LONG"
        ? raw + paper.config.slippage
        : raw - paper.config.slippage,
    stop = side === "LONG" ? a.demand.low - 0.25 : a.supply.high + 0.25,
    per = Math.abs(entry - stop) * point + paper.config.cost,
    qty = Math.floor(hardBudget / per);
  if (qty < 1) {
    latestPipeline[4] = pipelineRow(
      "Risk guardian",
      false,
      `One contract risks $${fmt(per)}, above the $${fmt(hardBudget)} budget`,
    );
    logAgent(
      "Risk rejection",
      latestPipeline[4].detail,
      "blocked",
      a.last.time,
    );
    return;
  }
  const risk = per * qty,
    target =
      side === "LONG"
        ? entry + (entry - stop) * paper.config.rr
        : entry - (stop - entry) * paper.config.rr;
  paper.position = {
    symbol,
    side,
    entry,
    stop,
    target,
    qty,
    risk,
    riskPerContract: per,
    openedAt: a.last.time,
    score: a.score,
    lastManagedBar: a.last.time,
  };
  paper.lastBar[symbol] = a.last.time;
  paper.arrivals[side] = { MES: null, MNQ: null };
  latestPipeline[5] = pipelineRow(
    "Paper executor",
    true,
    `${side} ${qty} ${symbol} @ ${fmt(entry)} · stop ${fmt(stop)} · target ${fmt(target)}`,
  );
  logAgent(
    "Paper position opened",
    latestPipeline[5].detail,
    "trade",
    a.last.time,
  );
}
function managePosition() {
  const p = paper.position,
    bars = getBars(p.symbol),
    bar = bars.at(-1);
  if (!bar || bar.time <= p.lastManagedBar) return;
  const stopHit = p.side === "LONG" ? bar.low <= p.stop : bar.high >= p.stop,
    targetHit = p.side === "LONG" ? bar.high >= p.target : bar.low <= p.target;
  p.lastManagedBar = bar.time;
  if (stopHit || targetHit) {
    const reason = stopHit ? "STOP" : "TARGET",
      exit = stopHit ? p.stop : p.target,
      points = p.side === "LONG" ? exit - p.entry : p.entry - exit,
      pnl = points * pointValue(p.symbol) * p.qty - paper.config.cost * p.qty,
      r = pnl / p.risk;
    paper.realizedPnl += pnl;
    paper.peakEquity = Math.max(
      paper.peakEquity,
      paper.startingCapital + paper.realizedPnl,
    );
    paper.trades.push({ ...p, exit, exitTime: bar.time, pnl, r, reason });
    paper.position = null;
    logAgent(
      `Paper ${reason.toLowerCase()} filled`,
      `${p.symbol} ${p.side} · P&L $${fmt(pnl)} · ${r.toFixed(2)}R`,
      pnl >= 0 ? "win" : "loss",
      bar.time,
    );
  } else
    logAgent(
      "Position monitored",
      `${p.symbol} ${p.side} · last ${fmt(bar.close)} · stop ${fmt(p.stop)} · target ${fmt(p.target)}`,
      "info",
      bar.time,
    );
  savePaper();
}

function renderPaper() {
  const equity = paper.startingCapital + paper.realizedPnl,
    now = state.analysis?.last?.time || Date.now() / 1000,
    trades = todayTrades(now),
    losses = consecutiveLosses(trades),
    failure = latestPipeline.find(
      (x) => !x.pass && x.name !== "Paper executor",
    );
  $("agent-equity").textContent = "$" + fmt(equity);
  $("agent-pnl").textContent =
    (paper.realizedPnl >= 0 ? "+" : "") +
    "$" +
    fmt(paper.realizedPnl) +
    " realized";
  $("agent-pnl").className = paper.realizedPnl >= 0 ? "positive" : "negative";
  $("agent-position").textContent = paper.position
    ? paper.position.side +
      " " +
      paper.position.qty +
      " " +
      paper.position.symbol
    : "NONE";
  $("agent-exposure").textContent =
    "$" + fmt(paper.position?.risk || 0) + " open risk";
  $("agent-trades-today").textContent =
    trades.length + " / " + paper.config.maxTrades;
  $("agent-losses").textContent = losses + " / " + paper.config.maxLosses;
  $("agent-state").textContent = paper.armed ? "ARMED" : "DISARMED";
  $("agent-state-note").textContent = paper.armed
    ? paper.position
      ? "Managing open position"
      : failure
        ? "Waiting: " + failure.detail
        : "All gates ready"
    : "No automatic evaluations";
  $("agent-chip").textContent = paper.armed
    ? "PAPER AGENT ARMED"
    : "PAPER AGENT OFF";
  $("agent-chip").className = "chip " + (paper.armed ? "green" : "");
  $("agent-enabled").checked = paper.armed;
  $("agent-toggle-label").textContent = paper.armed
    ? "Paper agent on"
    : "Paper agent off";
  $("agent-banner").className = "agent-banner " + (paper.armed ? "armed" : "");
  $("agent-banner").innerHTML = paper.armed
    ? `<b>Paper agent is armed${paper.position ? " and managing a position" : ", waiting for a fully qualified setup"}.</b><span>${failure ? failure.detail : "Every new candle is evaluated automatically."}</span>`
    : "<b>Paper agent is disarmed.</b><span>Turn it on to evaluate every new candle automatically.</span>";
  $("pipeline-badge").textContent = paper.position
    ? "POSITION OPEN"
    : latestPipeline.length
      ? latestPipeline.slice(0, 5).every((x) => x.pass)
        ? "ALL GATES PASS"
        : "ARMED · WAITING"
      : "IDLE";
  const rows = latestPipeline.length
    ? latestPipeline
    : [
        pipelineRow("Market agent", null, "Awaiting evaluation"),
        pipelineRow(
          "Strategy agent",
          null,
          "60m bias + 5m zone + 1m confirmation",
        ),
        pipelineRow("Intermarket guardian", null, "MES/MNQ second arrival"),
        pipelineRow("News guardian", null, "Official event lockouts"),
        pipelineRow("Risk guardian", null, "$160 absolute cap"),
        pipelineRow("Paper executor", null, "Simulated orders only"),
      ];
  $("pipeline").innerHTML = rows
    .map(
      (x, i) =>
        `<div><i>${i + 1}</i><span><b>${x.name}</b><small>${x.detail}</small></span><em class="${x.pass === true ? "pass" : x.pass === false ? "fail" : ""}">${x.pass === true ? "PASS" : x.pass === false ? "WAIT" : "—"}</em></div>`,
    )
    .join("");
  $("agent-log").innerHTML = paper.logs.length
    ? paper.logs
        .map(
          (l) =>
            `<div class="log-row"><b class="${l.type === "blocked" || l.type === "loss" ? "negative" : l.type === "trade" || l.type === "win" ? "positive" : ""}">${l.title}</b><span>${l.detail} · ${new Date(l.time * 1000).toLocaleString()}</span></div>`,
        )
        .join("")
    : '<div class="empty">No evaluations yet.</div>';
  $("agent-journal-body").innerHTML = paper.trades.length
    ? [...paper.trades]
        .reverse()
        .map(
          (t) =>
            `<tr><td>${new Date(t.exitTime * 1000).toLocaleString()}</td><td>${t.symbol}</td><td>${t.side}</td><td>${fmt(t.entry)}</td><td>${fmt(t.exit)}</td><td>${t.qty}</td><td class="${t.pnl >= 0 ? "positive" : "negative"}">$${fmt(t.pnl)}</td><td>${t.r.toFixed(2)}R</td><td>${t.reason}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="9" class="empty">No completed trades.</td></tr>';
  renderReview();
  syncInputs();
}
function renderReview() {
  const trades = paper.trades;
  if (!trades.length) {
    $("review-copy").innerHTML =
      "<b>No completed paper trades yet.</b><p>The review agent waits for evidence rather than inventing conclusions.</p>";
    return;
  }
  const wins = trades.filter((t) => t.pnl > 0),
    winRate = (wins.length / trades.length) * 100,
    avgR = trades.reduce((s, t) => s + t.r, 0) / trades.length,
    pf = Math.abs(
      wins.reduce((s, t) => s + t.pnl, 0) /
        (trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) || -1),
    );
  $("review-copy").innerHTML =
    `<b>${trades.length} completed trades · ${winRate.toFixed(1)}% win rate.</b><p>Average outcome ${avgR.toFixed(2)}R; profit factor ${pf.toFixed(2)}. ${avgR > 0 ? "The current sample is positive, but remains too small for live reliance." : "Current evidence does not support promotion toward live execution."}</p>`;
}
function syncInputs() {
  const map = {
    "agent-min-score": "minScore",
    "agent-rr": "rr",
    "agent-tolerance": "tolerance",
    "agent-daily-loss": "dailyLoss",
    "agent-max-trades": "maxTrades",
    "agent-max-losses": "maxLosses",
    "agent-max-drawdown": "maxDrawdown",
    "agent-max-lag": "maxLagMinutes",
  };
  for (const [id, key] of Object.entries(map))
    if (document.activeElement !== $(id)) $(id).value = paper.config[key];
  $("agent-intermarket").checked = paper.config.intermarket;
}
for (const [id, key] of Object.entries({
  "agent-min-score": "minScore",
  "agent-rr": "rr",
  "agent-tolerance": "tolerance",
  "agent-daily-loss": "dailyLoss",
  "agent-max-trades": "maxTrades",
  "agent-max-losses": "maxLosses",
  "agent-max-drawdown": "maxDrawdown",
  "agent-max-lag": "maxLagMinutes",
}))
  $(id).addEventListener("input", (e) => {
    paper.config[key] = +e.target.value;
    savePaper();
  });
$("agent-intermarket").addEventListener("change", (e) => {
  paper.config.intermarket = e.target.checked;
  paper.arrivals = emptyArrivals();
  savePaper();
});

$("agent-enabled").addEventListener("change", (e) => {
  paper.armed = e.target.checked;
  logAgent(
    paper.armed ? "Paper agent armed" : "Paper agent disarmed",
    paper.armed
      ? "Automatic evaluation begins on each new candle."
      : "No new entries will be created; open paper positions remain managed.",
    paper.armed ? "trade" : "info",
  );
  savePaper();
  if (paper.armed) evaluateAgent("manual");
});
$("agent-run").addEventListener("click", () => evaluateAgent("manual"));
$("agent-reset").addEventListener("click", () => {
  if (confirm("Reset the local paper account, position, trades and logs?")) {
    paper = agentDefaults();
    latestPipeline = [];
    savePaper();
  }
});
$("agent-export").addEventListener("click", () => {
  if (!paper.trades.length) return;
  const head =
      "exit_time,instrument,side,entry,exit,quantity,pnl,r_multiple,reason",
    rows = paper.trades.map((t) =>
      [
        new Date(t.exitTime * 1000).toISOString(),
        t.symbol,
        t.side,
        t.entry,
        t.exit,
        t.qty,
        t.pnl,
        t.r,
        t.reason,
      ].join(","),
    ),
    blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "aegis-paper-journal.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

function runBacktest() {
  if (!state.imported?.bars) {
    $("backtest-result").innerHTML =
      '<div class="empty">Import a CSV in Data & replay first.</div>';
    return;
  }
  const bars = state.imported.bars,
    symbol = state.imported.symbol,
    point = pointValue(symbol);
  let position = null,
    trades = [],
    realized = 0;
  for (let i = 900; i < bars.length; i++) {
    const bar = bars[i];
    if (position) {
      const stopHit =
          position.side === "LONG"
            ? bar.low <= position.stop
            : bar.high >= position.stop,
        targetHit =
          position.side === "LONG"
            ? bar.high >= position.target
            : bar.low <= position.target;
      if (stopHit || targetHit) {
        const exit = stopHit ? position.stop : position.target,
          points =
            position.side === "LONG"
              ? exit - position.entry
              : position.entry - exit,
          pnl =
            points * point * position.qty - paper.config.cost * position.qty;
        trades.push({
          ...position,
          exit,
          exitTime: bar.time,
          pnl,
          r: pnl / position.risk,
          reason: stopHit ? "STOP" : "TARGET",
        });
        realized += pnl;
        position = null;
      }
      continue;
    }
    const sample = bars.slice(Math.max(0, i - 2000), i + 1),
      a = analyzeStrategy(sample),
      dayTrades = trades.filter((t) => nyKey(t.exitTime) === nyKey(bar.time)),
      dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
    if (
      !inNYSession(bar.time) ||
      !a ||
      a.score < paper.config.minScore ||
      !a.zoneReturn ||
      !a.confirmation ||
      a.trend === "SIDEWAYS" ||
      dayTrades.length >= paper.config.maxTrades ||
      dayPnl <= -paper.config.dailyLoss ||
      consecutiveLosses(dayTrades) >= paper.config.maxLosses ||
      Math.max(0, -realized) >= paper.config.maxDrawdown
    )
      continue;
    const side = a.trend === "UPTREND" ? "LONG" : "SHORT",
      entry =
        side === "LONG"
          ? bar.close + paper.config.slippage
          : bar.close - paper.config.slippage,
      stop = side === "LONG" ? a.demand.low - 0.25 : a.supply.high + 0.25,
      per = Math.abs(entry - stop) * point + paper.config.cost,
      qty = Math.floor(160 / per);
    if (qty < 1) continue;
    position = {
      symbol,
      side,
      entry,
      stop,
      target:
        side === "LONG"
          ? entry + (entry - stop) * paper.config.rr
          : entry - (stop - entry) * paper.config.rr,
      qty,
      risk: per * qty,
      openedAt: bar.time,
      score: a.score,
    };
  }
  const wins = trades.filter((t) => t.pnl > 0),
    pnl = trades.reduce((s, t) => s + t.pnl, 0),
    wr = trades.length ? (wins.length / trades.length) * 100 : 0,
    avg = trades.length
      ? trades.reduce((s, t) => s + t.r, 0) / trades.length
      : 0,
    pf = Math.abs(
      wins.reduce((s, t) => s + t.pnl, 0) /
        (trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) || -1),
    );
  $("backtest-result").innerHTML =
    `<div class="panel-head"><div><h2>IMPORTED-DATA BACKTEST</h2><small>${bars.length.toLocaleString()} candles · ${symbol} · 60m/5m/1m rules · intermarket unavailable in one-symbol CSV</small></div><span class="badge ${pnl >= 0 ? "green" : "red"}">${pnl >= 0 ? "POSITIVE" : "NEGATIVE"} SAMPLE</span></div><div class="backtest-metrics"><div><small>TRADES</small><b>${trades.length}</b></div><div><small>WIN RATE</small><b>${wr.toFixed(1)}%</b></div><div><small>NET P&amp;L</small><b class="${pnl >= 0 ? "positive" : "negative"}">$${fmt(pnl)}</b></div><div><small>AVERAGE R</small><b>${avg.toFixed(2)}R</b></div><div><small>PROFIT FACTOR</small><b>${pf.toFixed(2)}</b></div></div><div class="review-copy"><b>Research interpretation</b><p>${trades.length < 30 ? "The sample is too small for strategy validation. Import a longer dataset." : avg > 0 ? "The rules produced positive expectancy in this sample; walk-forward and intermarket validation are still required." : "The strategy did not produce positive expectancy on this imported sample."}</p></div>`;
}
$("agent-backtest").addEventListener("click", runBacktest);
window.paperAgent = {
  onMarketUpdate: (source) => {
    if (paper.armed) evaluateAgent(source);
    else if (paper.position) managePosition();
  },
  onFeedError: (error) => {
    if (paper.armed) {
      logAgent("Feed lockout", error.message, "blocked");
      savePaper();
    }
  },
  evaluate: evaluateAgent,
};
renderPaper();
