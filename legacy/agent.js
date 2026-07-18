const AGENT_KEY = "aegis-paper-agent-v5";
const agentDefaults = () => ({
  armed: false,
  startingCapital: 2000,
  peakEquity: 2000,
  realizedPnl: 0,
  position: null,
  trades: [],
  logs: [],
  lastBar: {},
  config: {
    minScore: 60,
    targetNet: 162.5,
    dailyLoss: 320,
    maxTrades: 3,
    maxLosses: 2,
    maxDrawdown: 400,
    maxRisk: 160,
    cost: 2.4,
    slippage: 0.25,
    intermarket: true,
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
      };
    loaded.config.maxRisk = Math.min(
      160,
      Math.max(0, Number(loaded.config.maxRisk) || 160),
    );
    loaded.config.targetNet = Math.min(
      165,
      Math.max(50, Number(loaded.config.targetNet) || 162.5),
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
}
function nyKey(time = Date.now() / 1000) {
  return V5.nyMeta(time).date;
}
function inNYSession(time) {
  const ny = V5.nyMeta(time);
  return (
    !["Sat", "Sun"].includes(ny.weekday) && ny.minutes >= 570 && ny.minutes < 930
  );
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
function pipelineRow(name, pass, detail) {
  return { name, pass, detail };
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
      : ["MES", "MNQ"];
  let candidate = null,
    firstPipeline = null;
  for (const symbol of symbols) {
    const ev = window.aegisApp?.getEval(symbol),
      inter = paper.config.intermarket
        ? window.aegisApp?.getInter(symbol) || {
            pass: false,
            detail: "Waiting for both markets",
          }
        : { pass: true, detail: "Intermarket filter disabled" },
      bars = getBars(symbol),
      last = bars[bars.length - 1];
    if (!ev || !last) continue;
    if (paper.lastBar[symbol] === last.time && source !== "manual") continue;
    const fresh =
        state.mode === "REPLAY" ||
        Date.now() / 1000 - last.time <= 20 * 60,
      session = state.mode === "REPLAY" ? inNYSession(last.time) : inNYSession(Date.now() / 1000),
      structure = !!(ev.htfZone && ev.oneH),
      qualityFail =
        ev.bucket === "blocked80" ||
        ev.bucket === "notFresh" ||
        ev.bucket === "weakZone",
      quality =
        !!ev.entryZone &&
        !qualityFail &&
        (ev.score ?? 0) >= paper.config.minScore,
      calendarReady = state.eventStatus === "READY",
      news =
        state.mode === "REPLAY"
          ? true
          : calendarReady && !newsLocked(last.time),
      trades = todayTrades(last.time),
      dailyPnl = trades.reduce((s, t) => s + t.pnl, 0),
      losses = consecutiveLosses(trades),
      drawdown = accountDrawdown(),
      locksOk =
        dailyPnl > -paper.config.dailyLoss &&
        trades.length < paper.config.maxTrades &&
        losses < paper.config.maxLosses &&
        drawdown < paper.config.maxDrawdown,
      risk = locksOk && !!ev.plan;
    const rows = [
      pipelineRow(
        "Market agent",
        fresh && session,
        `${session ? "NY session" : "outside NY session"} · ${fresh ? "fresh data" : "stale data"} · last ${fmt(last.close)}`,
      ),
      pipelineRow(
        "Structure agent",
        structure,
        structure
          ? `${V5.TF_LABEL[ev.htf]} ${ev.htfZone.pattern} ${ev.htfZone.type}${ev.htf === "240" ? " (4H promoted)" : ""} → 1H ${ev.oneH.pattern} nested`
          : ev.detail || "No nested Daily→4H→1H stack in range",
      ),
      pipelineRow(
        "Zone quality",
        quality,
        ev.entryZone
          ? qualityFail
            ? ev.detail
            : `${V5.TF_LABEL[ev.entryTf]} ${ev.entryZone.pattern} · score ${ev.score}${ev.nyCaution ? " · NY 1H caution" : ""}${ev.refined15 ? " · refined to 15M" : ""}`
          : "No qualified entry zone",
      ),
      pipelineRow("Intermarket guardian", inter.pass, inter.detail),
      pipelineRow(
        "News guardian",
        news,
        state.mode === "REPLAY"
          ? "Replay mode: calendar not applied"
          : !calendarReady
            ? "Calendar unavailable; fail-safe lock"
            : news
              ? "No scheduled event inside ±30m"
              : "High-impact lockout",
      ),
      pipelineRow(
        "Risk guardian",
        risk,
        !locksOk
          ? `Locked: $${fmt(dailyPnl)} today · ${trades.length}/${paper.config.maxTrades} trades · ${losses}/${paper.config.maxLosses} losses · $${fmt(drawdown)} drawdown`
          : ev.plan
            ? `${ev.plan.qty} contract${ev.plan.qty > 1 ? "s" : ""} · $${fmt(ev.plan.risk)} risk · ${ev.refined15 ? "15M refined" : "1H direct"}`
            : ev.bucket === "riskUnfit"
              ? ev.detail
              : "No sizing plan available",
      ),
      pipelineRow("Paper executor", false, "Awaiting all gates"),
    ];
    if (!firstPipeline) firstPipeline = rows;
    const allPass = rows.slice(0, 6).every((x) => x.pass);
    if (allPass && ev.atEntry) {
      candidate = { symbol, ev, rows, time: last.time, price: last.close };
      break;
    } else if (allPass) {
      rows[6] = pipelineRow(
        "Paper executor",
        false,
        "All gates pass — waiting for the first return into the entry zone",
      );
      firstPipeline = rows;
    }
    paper.lastBar[symbol] = last.time;
  }
  latestPipeline = candidate
    ? candidate.rows
    : firstPipeline || [
        pipelineRow("Market agent", false, "Waiting for the 60-day history"),
        pipelineRow("Structure agent", false, "Daily→4H→1H nesting pending"),
        pipelineRow("Zone quality", false, "Pattern · freshness · 80% rule"),
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
    latestPipeline[6] = pipelineRow(
      "Paper executor",
      false,
      "Candidate found, but paper agent is switched off",
    );
    logAgent("Candidate only", latestPipeline[6].detail, "info", candidate.time);
    savePaper();
    return;
  }
  openPaperPosition(candidate);
  savePaper();
}

function openPaperPosition({ symbol, ev, time, price }) {
  const point = V5.pointValue(symbol),
    cfg = paper.config,
    side = ev.plan.side,
    entry = side === "LONG" ? price + cfg.slippage : price - cfg.slippage,
    stop = ev.plan.stop,
    stopPoints = Math.abs(entry - stop),
    per = stopPoints * point + cfg.cost,
    qty = Math.floor(Math.min(160, cfg.maxRisk) / per);
  if (qty < 1) {
    latestPipeline[5] = pipelineRow(
      "Risk guardian",
      false,
      `One contract risks $${fmt(per)} from the live price, above the $${fmt(cfg.maxRisk)} budget`,
    );
    logAgent("Risk rejection", latestPipeline[5].detail, "blocked", time);
    return;
  }
  const targetPoints = (cfg.targetNet + cfg.cost * qty) / (point * qty),
    target = side === "LONG" ? entry + targetPoints : entry - targetPoints;
  paper.position = {
    symbol,
    side,
    entry,
    stop,
    target,
    qty,
    risk: per * qty,
    riskPerContract: per,
    openedAt: time,
    score: ev.score,
    entryTf: V5.TF_LABEL[ev.entryTf],
    pattern: ev.entryZone.pattern,
    lastManagedBar: time,
  };
  paper.lastBar[symbol] = time;
  latestPipeline[6] = pipelineRow(
    "Paper executor",
    true,
    `${side} ${qty} ${symbol} @ ${fmt(entry)} · ${paper.position.entryTf} ${paper.position.pattern} · stop ${fmt(stop)} · target ${fmt(target)}`,
  );
  logAgent("Paper position opened", latestPipeline[6].detail, "trade", time);
}
function managePosition() {
  const p = paper.position,
    bars = getBars(p.symbol),
    bar = bars[bars.length - 1];
  if (!bar || bar.time <= p.lastManagedBar) return;
  const stopHit = p.side === "LONG" ? bar.low <= p.stop : bar.high >= p.stop,
    targetHit = p.side === "LONG" ? bar.high >= p.target : bar.low <= p.target;
  p.lastManagedBar = bar.time;
  if (stopHit || targetHit) {
    const reason = stopHit ? "STOP" : "TARGET",
      exit = stopHit ? p.stop : p.target,
      points = p.side === "LONG" ? exit - p.entry : p.entry - exit,
      pnl = points * V5.pointValue(p.symbol) * p.qty - paper.config.cost * p.qty,
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
    now = Date.now() / 1000,
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
    ? `<b>Paper agent is armed${paper.position ? " and managing a position" : ", waiting for a fully qualified v5 setup"}.</b><span>${failure ? failure.detail : "Every new candle is evaluated automatically."}</span>`
    : "<b>Paper agent is disarmed.</b><span>Turn it on to evaluate every new candle automatically.</span>";
  $("pipeline-badge").textContent = paper.position
    ? "POSITION OPEN"
    : latestPipeline.length
      ? latestPipeline.slice(0, 6).every((x) => x.pass)
        ? "ALL GATES PASS"
        : "ARMED · WAITING"
      : "IDLE";
  const rows = latestPipeline.length
    ? latestPipeline
    : [
        pipelineRow("Market agent", null, "Awaiting evaluation"),
        pipelineRow("Structure agent", null, "Daily→4H→1H strict nesting"),
        pipelineRow("Zone quality", null, "Pattern · freshness · 80% rule"),
        pipelineRow(
          "Intermarket guardian",
          null,
          "MES/MNQ directional agreement",
        ),
        pipelineRow("News guardian", null, "Official event lockouts"),
        pipelineRow("Risk guardian", null, "$160 cap · risk-adaptive 1H/15M"),
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
const AGENT_INPUTS = {
  "agent-min-score": "minScore",
  "agent-target": "targetNet",
  "agent-daily-loss": "dailyLoss",
  "agent-max-trades": "maxTrades",
  "agent-max-losses": "maxLosses",
  "agent-max-drawdown": "maxDrawdown",
};
function syncInputs() {
  for (const [id, key] of Object.entries(AGENT_INPUTS))
    if (document.activeElement !== $(id)) $(id).value = paper.config[key];
  $("agent-intermarket").checked = paper.config.intermarket;
}
for (const [id, key] of Object.entries(AGENT_INPUTS))
  $(id).addEventListener("input", (e) => {
    paper.config[key] = +e.target.value;
    savePaper();
  });
$("agent-intermarket").addEventListener("change", (e) => {
  paper.config.intermarket = e.target.checked;
  savePaper();
});

$("agent-enabled").addEventListener("change", (e) => {
  paper.armed = e.target.checked;
  logAgent(
    paper.armed ? "Paper agent armed" : "Paper agent disarmed",
    paper.armed
      ? "Automatic v5 evaluation begins on each new candle."
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

/* Single-instrument CSV backtest under the full v5 rules (intermarket
   confirmation is unavailable with one symbol and is skipped, labelled). */
function runBacktest() {
  if (!state.imported?.bars) {
    $("backtest-result").innerHTML =
      '<div class="empty">Import a CSV in Data & replay first.</div>';
    return;
  }
  const symbol = state.imported.symbol,
    point = V5.pointValue(symbol),
    cfg = paper.config,
    stack = V5.buildStack(state.imported.bars),
    exec = stack.exec;
  let position = null;
  const trades = [];
  let realized = 0,
    peak = 0,
    maxDrawdown = 0;
  for (let i = 30; i < exec.length; i++) {
    const bar = exec[i],
      ny = V5.nyMeta(bar.time);
    if (position) {
      const stopHit =
          position.side === "LONG"
            ? bar.low <= position.stop
            : bar.high >= position.stop,
        targetHit =
          position.side === "LONG"
            ? bar.high >= position.target
            : bar.low <= position.target,
        sessionExit = ny.minutes >= 925;
      if (stopHit || targetHit || sessionExit) {
        const exit = stopHit
            ? position.stop
            : targetHit
              ? position.target
              : bar.close,
          points =
            position.side === "LONG"
              ? exit - position.entry
              : position.entry - exit,
          pnl = points * point * position.qty - cfg.cost * position.qty;
        trades.push({
          ...position,
          exit,
          exitTime: bar.time,
          pnl,
          r: pnl / position.risk,
          reason: stopHit ? "STOP" : targetHit ? "TARGET" : "SESSION",
        });
        realized += pnl;
        peak = Math.max(peak, realized);
        maxDrawdown = Math.max(maxDrawdown, peak - realized);
        position = null;
      }
      continue;
    }
    if (!inNYSession(bar.time)) continue;
    const dayTrades = trades.filter(
        (t) => nyKey(t.exitTime) === nyKey(bar.time),
      ),
      dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0);
    if (
      dayTrades.length >= cfg.maxTrades ||
      dayPnl <= -cfg.dailyLoss ||
      consecutiveLosses(dayTrades) >= cfg.maxLosses ||
      maxDrawdown >= cfg.maxDrawdown
    )
      continue;
    const ev = V5.evaluate(stack, {
      symbol,
      time: bar.time + 300,
      price: bar.close,
      mode: "strict",
      config: { freshGraceSec: 300, targetNet: cfg.targetNet, maxRisk: cfg.maxRisk },
    });
    if (!ev.plan || ev.bucket || (ev.score ?? 0) < cfg.minScore) continue;
    const zone = ev.entryZone,
      touching =
        zone.type === "demand"
          ? bar.low <= zone.proximal
          : bar.high >= zone.proximal;
    if (!touching) continue;
    const next = exec[i + 1];
    if (!next || nyKey(next.time) !== nyKey(bar.time)) continue;
    const side = ev.plan.side,
      entry =
        side === "LONG" ? next.open + cfg.slippage : next.open - cfg.slippage,
      stop = ev.plan.stop,
      per = Math.abs(entry - stop) * point + cfg.cost,
      qty = Math.floor(Math.min(160, cfg.maxRisk) / per);
    if (qty < 1) continue;
    const targetPoints = (cfg.targetNet + cfg.cost * qty) / (point * qty);
    position = {
      symbol,
      side,
      entry,
      stop,
      target: side === "LONG" ? entry + targetPoints : entry - targetPoints,
      qty,
      risk: per * qty,
      openedAt: next.time,
      score: ev.score,
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
    `<div class="panel-head"><div><h2>IMPORTED-DATA BACKTEST · v5</h2><small>${state.imported.bars.length.toLocaleString()} candles · ${symbol} · strict Daily→4H→1H nesting · intermarket unavailable in one-symbol CSV</small></div><span class="badge ${pnl >= 0 ? "green" : "red"}">${pnl >= 0 ? "POSITIVE" : "NEGATIVE"} SAMPLE</span></div><div class="backtest-metrics"><div><small>TRADES</small><b>${trades.length}</b></div><div><small>WIN RATE</small><b>${wr.toFixed(1)}%</b></div><div><small>NET P&amp;L</small><b class="${pnl >= 0 ? "positive" : "negative"}">$${fmt(pnl)}</b></div><div><small>AVERAGE R</small><b>${avg.toFixed(2)}R</b></div><div><small>PROFIT FACTOR</small><b>${pf.toFixed(2)}</b></div></div><div class="review-copy"><b>Research interpretation</b><p>${trades.length === 0 ? "No setup passed the strict v5 nesting rules on this dataset — that scarcity is expected and is reported honestly rather than loosened silently." : trades.length < 30 ? "The sample is too small for strategy validation. Import a longer dataset." : avg > 0 ? "The rules produced positive expectancy in this sample; walk-forward and intermarket validation are still required." : "The strategy did not produce positive expectancy on this imported sample."}</p></div>`;
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
