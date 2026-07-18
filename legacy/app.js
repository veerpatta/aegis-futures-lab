const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
const V5 = window.AegisV5;
const state = {
  symbol: "MES",
  feeds: { MES: null, MNQ: null },
  history: { MES: null, MNQ: null },
  stacks: { MES: null, MNQ: null },
  evals: { MES: null, MNQ: null },
  inter: { MES: null, MNQ: null },
  mode: "DELAYED",
  imported: null,
  replayIndex: 0,
  replayTimer: null,
  chart: null,
  series: null,
  analysis: null,
  events: [],
  eventStatus: "LOADING",
};

document.querySelectorAll("nav button").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("nav button")
      .forEach((x) => x.classList.remove("active"));
    document
      .querySelectorAll(".page")
      .forEach((x) => x.classList.remove("active"));
    button.classList.add("active");
    $(button.dataset.page).classList.add("active");
    $("page-title").textContent = button.textContent.trim();
  }),
);
document.querySelectorAll("[data-symbol]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-symbol]")
      .forEach((x) => x.classList.remove("active"));
    button.classList.add("active");
    state.symbol = button.dataset.symbol;
    renderMarket();
  }),
);

function updateClock() {
  const now = new Date();
  $("ny-clock").textContent =
    "New York · " +
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  const ny = V5.nyMeta(now.getTime() / 1000);
  const active =
    !["Sat", "Sun"].includes(ny.weekday) && ny.minutes >= 570 && ny.minutes < 930;
  $("session-chip").textContent = active
    ? "NY SESSION ACTIVE"
    : "NY SESSION CLOSED";
  $("session-chip").className = "chip " + (active ? "green" : "");
}
setInterval(updateClock, 1000);
updateClock();

async function loadFeeds() {
  const refresh = $("refresh");
  refresh.disabled = true;
  $("feed-chip").textContent = "REFRESHING";
  try {
    const [mes, mnq] = await Promise.all(
      ["MES", "MNQ"].map((s) =>
        fetch("/api/market?symbol=" + s).then(async (r) => {
          if (!r.ok)
            throw new Error((await r.json()).error || "Feed unavailable");
          return r.json();
        }),
      ),
    );
    state.feeds = { MES: mes, MNQ: mnq };
    if (state.mode !== "REPLAY") state.mode = "DELAYED";
    $("feed-chip").textContent =
      state.mode === "REPLAY" ? "LOCAL REPLAY" : "FREE DELAYED";
    $("feed-chip").className =
      "chip " + (state.mode === "REPLAY" ? "green" : "amber");
    $("last-update").textContent =
      "Refreshed " + new Date().toLocaleTimeString() + " · automatic every 60s";
    renderMarket();
    window.paperAgent?.onMarketUpdate("feed");
  } catch (error) {
    $("feed-chip").textContent = "FEED OFFLINE";
    $("feed-chip").className = "chip red";
    $("last-update").textContent = error.message;
    $("data-notice").innerHTML =
      "<b>Feed unavailable.</b> Execution remains locked. Import a CSV to use the replay engine.";
    window.paperAgent?.onFeedError(error);
  } finally {
    refresh.disabled = false;
  }
}
$("refresh").addEventListener("click", loadFeeds);
setInterval(loadFeeds, 60000);

async function loadHistory() {
  try {
    const [mes, mnq] = await Promise.all(
      ["MES", "MNQ"].map((s) =>
        fetch("/api/history?symbol=" + s).then(async (r) => {
          if (!r.ok)
            throw new Error((await r.json()).error || "History unavailable");
          return r.json();
        }),
      ),
    );
    state.history = { MES: mes, MNQ: mnq };
    state.stacks = {
      MES: V5.buildStack(mes.bars),
      MNQ: V5.buildStack(mnq.bars),
    };
    renderMarket();
    window.paperAgent?.onMarketUpdate("history");
  } catch (error) {
    $("zone-detail").textContent = "History unavailable: " + error.message;
  }
}
setInterval(loadHistory, 15 * 60 * 1000);

function getBars(symbol = state.symbol) {
  if (
    state.mode === "REPLAY" &&
    state.imported &&
    state.imported.symbol === symbol
  )
    return state.imported.bars.slice(0, state.replayIndex + 1);
  return state.feeds[symbol]?.bars || [];
}

function atrOf(bars, n = 14) {
  if (!bars || bars.length < 2) return null;
  const recent = bars.slice(-n - 1);
  let sum = 0,
    count = 0;
  for (let i = 1; i < recent.length; i++) {
    sum += Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close),
    );
    count++;
  }
  return count ? sum / count : null;
}

/* Compute the v5 evaluation for both symbols against the freshest price. */
function computeEvals() {
  const nowSec = Date.now() / 1000;
  if (state.mode === "REPLAY" && state.imported) {
    const symbol = state.imported.symbol,
      bars = getBars(symbol);
    if (bars.length >= 30) {
      const stack = V5.buildStack(bars),
        last = bars[bars.length - 1];
      state.stacks[symbol] = stack;
      state.evals[symbol] = V5.evaluate(stack, {
        symbol,
        time: last.time + 60,
        price: last.close,
        mode: "strict",
        config: { freshGraceSec: 45 * 60 },
      });
      const other = symbol === "MES" ? "MNQ" : "MES";
      state.evals[other] = null;
      state.inter[symbol] = {
        pass: true,
        detail: "Single-instrument replay: intermarket comparison not available",
      };
    }
    return;
  }
  for (const symbol of ["MES", "MNQ"]) {
    const stack = state.stacks[symbol];
    if (!stack || !stack.exec.length) {
      state.evals[symbol] = null;
      continue;
    }
    const price =
      state.feeds[symbol]?.price ?? stack.exec[stack.exec.length - 1].close;
    state.evals[symbol] = V5.evaluate(stack, {
      symbol,
      time: nowSec,
      price,
      mode: "strict",
      config: { freshGraceSec: 45 * 60 },
    });
  }
  for (const symbol of ["MES", "MNQ"]) {
    const other = symbol === "MES" ? "MNQ" : "MES";
    state.inter[symbol] = V5.intermarketCheck(
      state.evals[symbol],
      state.evals[other],
      other,
      state.stacks[symbol]?.exec,
    );
  }
}

function newsLockedNow() {
  return state.events.some(
    (e) => Math.abs(new Date(e.time).getTime() - Date.now()) <= 30 * 60 * 1000,
  );
}

function renderMarket() {
  computeEvals();
  const data = state.feeds[state.symbol],
    bars = getBars();
  state.analysis = state.evals[state.symbol];
  if (state.feeds.MES) {
    const m = state.feeds.MES;
    $("mes-price").textContent = fmt(m.price);
    $("mes-change").textContent =
      (m.change >= 0 ? "+" : "") + fmt(m.change) + " from prior close";
    $("mes-change").className = m.change >= 0 ? "positive" : "negative";
  }
  if (state.feeds.MNQ) {
    const m = state.feeds.MNQ;
    $("mnq-price").textContent = fmt(m.price);
    $("mnq-change").textContent =
      (m.change >= 0 ? "+" : "") + fmt(m.change) + " from prior close";
    $("mnq-change").className = m.change >= 0 ? "positive" : "negative";
  }
  $("chart-heading").textContent = state.symbol + " · 1 MINUTE";
  $("chart-provenance").textContent =
    state.mode === "REPLAY"
      ? "Local CSV replay · " + bars.length + " candles"
      : data
        ? data.source + " · " + bars.length + " candles"
        : "No source";
  renderChart(bars);
  renderDecision();
}

function renderChart(bars) {
  if (!bars.length) return;
  if (window.LightweightCharts) {
    $("chart-fallback").classList.add("hidden");
    if (state.chart) state.chart.remove();
    state.chart = LightweightCharts.createChart($("chart"), {
      layout: { background: { color: "#09101a" }, textColor: "#7f8da2" },
      grid: {
        vertLines: { color: "#182333" },
        horzLines: { color: "#182333" },
      },
      rightPriceScale: { borderColor: "#263244" },
      timeScale: {
        borderColor: "#263244",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    state.series = state.chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#2dd4a0",
      downColor: "#ff6b75",
      borderVisible: false,
      wickUpColor: "#2dd4a0",
      wickDownColor: "#ff6b75",
    });
    state.series.setData(
      bars.map(({ time, open, high, low, close }) => ({
        time,
        open,
        high,
        low,
        close,
      })),
    );
    const ev = state.evals[state.symbol];
    if (ev?.htfZone) {
      const dashed = LightweightCharts.LineStyle.Dashed;
      const addLine = (price, color, title, style) =>
        state.series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: style ?? dashed,
          axisLabelVisible: true,
          title,
        });
      addLine(
        ev.htfZone.proximal,
        "#6ea8fe",
        `${V5.TF_LABEL[ev.htf]} ${ev.htfZone.type} proximal`,
      );
      addLine(
        ev.htfZone.distal,
        "#6ea8fe",
        `${V5.TF_LABEL[ev.htf]} distal`,
      );
      if (ev.entryZone && ev.entryZone !== ev.htfZone) {
        const c = ev.entryZone.type === "demand" ? "#2dd4a0" : "#ff6b75";
        addLine(
          ev.entryZone.proximal,
          c,
          `${V5.TF_LABEL[ev.entryTf]} entry proximal`,
          LightweightCharts.LineStyle.Solid,
        );
        addLine(
          ev.entryZone.distal,
          c,
          `${V5.TF_LABEL[ev.entryTf]} entry distal`,
        );
      }
    }
    state.chart.timeScale().fitContent();
  } else {
    setTimeout(() => renderChart(bars), 300);
  }
}

function zoneTagHtml(z, opts = {}) {
  if (!z) return "";
  const tags = [];
  if (z.firstReturnAt === null) tags.push('<i class="ztag fresh">FRESH</i>');
  else tags.push('<i class="ztag tested">TESTED</i>');
  if (z.achievedAt !== null) tags.push('<i class="ztag achieved">ACHIEVED</i>');
  if (z.reaction) tags.push('<i class="ztag reaction">REACTION</i>');
  if (z.blocked80) tags.push('<i class="ztag blocked">80% BLOCK</i>');
  if (z.wickTolerance) tags.push('<i class="ztag wick">WICK-TOL</i>');
  if (z.gapConverted) tags.push('<i class="ztag gap">GAP CONV</i>');
  if (z.wide && !opts.hideWide) tags.push('<i class="ztag wide">WIDE→15M</i>');
  return tags.join("");
}
function zoneRowHtml(label, z, extra = "") {
  if (!z)
    return `<div class="zone-item"><div><b>${label}</b><span>Not present</span></div><strong class="dim">—</strong></div>`;
  const formed = new Date(z.formedAt * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `<div class="zone-item"><div><b><i class="tfchip">${label}</i><i class="pat ${z.type}">${z.pattern}</i> ${z.type}</b><span>${fmt(z.low)} – ${fmt(z.high)} · formed ${formed}${extra ? " · " + extra : ""}</span><span class="tagrow">${zoneTagHtml(z)}</span></div><strong class="${z.type === "demand" ? "positive" : "negative"}">${z.type === "demand" ? "▲" : "▼"}</strong></div>`;
}

function renderDecision() {
  const symbol = state.symbol,
    ev = state.evals[symbol],
    stack = state.stacks[symbol],
    inter = state.inter[symbol],
    liveBars = getBars(symbol),
    stale =
      state.mode === "REPLAY"
        ? false
        : !liveBars.length ||
          Date.now() / 1000 - liveBars[liveBars.length - 1].time > 20 * 60,
    calendarReady = state.eventStatus === "READY",
    newsOk = calendarReady && !newsLockedNow();

  // KPI cards
  if (!ev) {
    $("bias").textContent = "—";
    $("bias-detail").textContent = "Waiting for 60-day history";
    $("zone-score").textContent = "—";
    $("zone-detail").textContent = "Strategy v5 engine";
  } else {
    $("bias").textContent = ev.side || "NEUTRAL";
    $("bias-detail").textContent = ev.htfZone
      ? `${V5.TF_LABEL[ev.htf]} HTF · strict nesting`
      : ev.detail;
    $("zone-score").textContent = ev.score ?? "—";
    $("zone-detail").textContent = ev.entryZone
      ? `${V5.TF_LABEL[ev.entryTf]} ${ev.entryZone.pattern} entry zone`
      : "No qualified entry zone";
  }

  // Signals cards
  $("signal-trend").textContent = ev?.side
    ? `${ev.side} · ${V5.TF_LABEL[ev.htf]}`
    : "NEUTRAL";
  const atr = atrOf(stack?.exec || liveBars);
  $("signal-vol").textContent = atr ? fmt(atr) + " pts" : "—";
  $("signal-confidence").textContent = stale
    ? "STALE"
    : stack
      ? "HIGH"
      : "LIMITED";

  // Decision gate rows (v5 pre-trade checklist §8)
  const na = { pass: null };
  const row = (name, pass, detail) => ({ name, pass, detail });
  const rows = [];
  if (!ev) {
    rows.push(row("Daily HTF zone (4H fallback)", null, "Loading history…"));
  } else {
    rows.push(
      row(
        "Daily HTF zone (4H fallback)",
        !!ev.htfZone,
        ev.htfZone
          ? `${V5.TF_LABEL[ev.htf]} ${ev.htfZone.pattern} ${ev.htfZone.type} · ${fmt(ev.htfZone.low)}–${fmt(ev.htfZone.high)}${ev.htf === "240" ? " · 4H promoted (no Daily zone in range)" : ""}`
          : "No valid Daily or 4H zone in the current price region",
      ),
      row(
        "Strict nesting Daily→4H→1H",
        ev.oneH ? true : ev.bucket === "nesting" ? false : null,
        ev.oneH
          ? `${ev.fourH ? "4H inside Daily · " : ""}1H ${ev.oneH.pattern} inside ${ev.fourH ? "4H" : V5.TF_LABEL[ev.htf]} · rectangle containment`
          : ev.bucket === "nesting"
            ? ev.detail
            : "Waiting for HTF zone",
      ),
      row(
        "Entry pattern & freshness",
        ev.entryZone
          ? ev.bucket === "notFresh"
            ? false
            : true
          : null,
        ev.entryZone
          ? ev.bucket === "notFresh"
            ? ev.detail
            : `${ev.entryZone.pattern} · ${ev.entryZone.baseCount} base candle${ev.entryZone.baseCount > 1 ? "s" : ""}${ev.entryZone.wickTolerance ? " · wick-tolerance path" : ""} · first return only`
          : "No entry zone yet",
      ),
      row(
        "80% first-counter-zone rule",
        ev.bucket === "blocked80" ? false : ev.entryZone ? true : null,
        ev.bucket === "blocked80"
          ? ev.detail
          : ev.entryZone
            ? "Not the first counter zone after an HTF reaction"
            : "Awaiting entry zone",
      ),
      row(
        "Risk fit $160 (1H → 15M)",
        ev.plan ? true : ev.bucket === "riskUnfit" ? false : null,
        ev.plan
          ? `${ev.refined15 ? "Refined to 15M inside the 1H zone" : "1H structural stop fits directly"} · ${ev.plan.qty} contract${ev.plan.qty > 1 ? "s" : ""} · $${fmt(ev.plan.risk)} risk`
          : ev.bucket === "riskUnfit"
            ? ev.detail
            : "Awaiting qualified zone",
      ),
      row(
        "Intermarket MES ↔ MNQ",
        inter ? inter.pass : null,
        inter?.detail || "Waiting for both markets",
      ),
    );
  }
  rows.push(
    row(
      "News lockout ±30m",
      calendarReady ? newsOk : false,
      !calendarReady
        ? "Calendar unavailable; fail-safe lock"
        : newsOk
          ? "No scheduled high-impact event inside ±30m"
          : "High-impact event lockout active",
    ),
    row(
      "Data freshness",
      !stale,
      stale ? "Live candles older than 20 minutes" : "Within threshold",
    ),
  );

  const ready =
    ev?.plan &&
    ev.atEntry &&
    !ev.bucket &&
    inter?.pass &&
    newsOk &&
    !stale;
  const armed = $("agent-chip").textContent.includes("ARMED");
  $("gate-badge").textContent = stale
    ? "DATA LOCK"
    : ready
      ? "PAPER READY"
      : armed
        ? "AGENT WAITING"
        : "MONITORING";
  $("gate-badge").className =
    "badge " + (stale ? "red" : ready ? "green" : "amber");
  $("gate-copy").className = "gate " + (ready ? "allowed" : "");
  $("gate-copy").innerHTML = stale
    ? "<b>Data is stale; all agent actions are paused</b><span>Fresh candles are required before strategy evaluation resumes.</span>"
    : ready
      ? `<b>${symbol} setup passes the full v5 pipeline</b><span>Price is inside a fresh ${V5.TF_LABEL[ev.entryTf]} ${ev.entryZone.pattern} zone nested in the ${V5.TF_LABEL[ev.htf]} structure. Real-money execution remains locked on the delayed research feed.</span>`
      : `<b>${armed ? "Paper agent is armed and waiting" : "Strategy v5 monitor is active"}</b><span>${ev ? (ev.bucket ? ev.detail : ev.atEntry ? "Waiting on intermarket/news/data gates." : "Structure qualified — waiting for the first return into the entry zone.") : "The engine starts after the 60-day history loads."}</span>`;
  $("checks").innerHTML = rows
    .map(
      (r) =>
        `<div class="check"><span>${r.name}<small> · ${r.detail}</small></span><b class="${r.pass === true ? "pass" : r.pass === false ? "fail" : "dim"}">${r.pass === true ? "PASS" : r.pass === false ? "WAIT" : "—"}</b></div>`,
    )
    .join("");

  // Nested zone stack panel
  if (!ev || !stack) {
    $("zone-list").innerHTML =
      '<div class="empty">Waiting for the 60-day zone history…</div>';
  } else if (!ev.htfZone) {
    const context = (stack.zones.D || [])
      .filter((z) => z.brokenAt === null)
      .slice(-3);
    $("zone-list").innerHTML =
      `<div class="empty">No HTF zone in the current price region.</div>` +
      context.map((z) => zoneRowHtml("Daily", z, "context")).join("");
  } else {
    const rowsHtml = [
      zoneRowHtml(V5.TF_LABEL[ev.htf], ev.htfZone, "primary HTF"),
      ev.htf === "D" ? zoneRowHtml("4H", ev.fourH, "nested") : "",
      zoneRowHtml("1H", ev.oneH, "nested"),
      ev.refined15 ? zoneRowHtml("15M", ev.entryZone, "risk refinement") : "",
    ];
    const reactions = (stack.zones.D || []).filter(
      (z) => z.reaction && z.brokenAt === null,
    );
    if (reactions.length)
      rowsHtml.push(
        zoneRowHtml("Daily", reactions[reactions.length - 1], "reaction context — not tradeable"),
      );
    $("zone-list").innerHTML = rowsHtml.filter(Boolean).join("");
  }

  // Audit trace
  $("audit-body").innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td class="${r.pass === true ? "positive" : r.pass === false ? "negative" : ""}">${r.pass === true ? "PASS" : r.pass === false ? "WAIT" : "—"}</td><td>${r.detail}</td></tr>`,
    )
    .join("");
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/),
    headers = lines
      .shift()
      .split(",")
      .map((x) => x.trim().toLowerCase());
  const idx = (n) => headers.indexOf(n);
  for (const h of ["timestamp", "open", "high", "low", "close"])
    if (idx(h) < 0) throw new Error("Missing required column: " + h);
  return lines
    .map((line, i) => {
      const c = line.split(",");
      const raw = c[idx("timestamp")].trim();
      let time = Math.floor(new Date(raw).getTime() / 1000);
      if (!Number.isFinite(time)) time = Number(raw);
      const bar = {
        time,
        open: +c[idx("open")],
        high: +c[idx("high")],
        low: +c[idx("low")],
        close: +c[idx("close")],
        volume: idx("volume") >= 0 ? +c[idx("volume")] : 0,
      };
      if (
        !Number.isFinite(time) ||
        ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      )
        throw new Error("Invalid candle at data row " + (i + 2));
      return bar;
    })
    .sort((a, b) => a.time - b.time);
}
$("csv-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const bars = parseCSV(await file.text());
    if (bars.length < 15) throw new Error("At least 15 candles are required.");
    state.imported = { symbol: $("import-symbol").value, bars };
    state.mode = "REPLAY";
    state.symbol = state.imported.symbol;
    state.replayIndex = Math.min(49, bars.length - 1);
    $("replay-range").max = bars.length - 1;
    $("replay-range").value = state.replayIndex;
    $("replay-range").disabled = false;
    $("replay-play").disabled = false;
    $("replay-step").disabled = false;
    $("import-result").innerHTML =
      `<b class="positive">${bars.length.toLocaleString()} candles loaded.</b> ${new Date(bars[0].time * 1000).toLocaleString()} → ${new Date(bars.at(-1).time * 1000).toLocaleString()}`;
    $("feed-chip").textContent = "LOCAL REPLAY";
    $("feed-chip").className = "chip green";
    updateReplay();
  } catch (error) {
    $("import-result").innerHTML =
      '<span class="negative">' + error.message + "</span>";
  }
});
function updateReplay() {
  const b = state.imported?.bars[state.replayIndex];
  if (!b) return;
  $("replay-price").textContent = state.imported.symbol + " " + fmt(b.close);
  $("replay-state").textContent =
    `Candle ${state.replayIndex + 1} of ${state.imported.bars.length} · ${new Date(b.time * 1000).toLocaleString()}`;
  $("replay-range").value = state.replayIndex;
  renderMarket();
  window.paperAgent?.onMarketUpdate("replay");
}
$("replay-range").addEventListener("input", (e) => {
  state.replayIndex = +e.target.value;
  updateReplay();
});
$("replay-step").addEventListener("click", () => {
  if (state.replayIndex < state.imported.bars.length - 1) {
    state.replayIndex++;
    updateReplay();
  }
});
$("replay-play").addEventListener("click", () => {
  if (state.replayTimer) {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
    $("replay-play").textContent = "▶ Play";
    return;
  }
  $("replay-play").textContent = "Ⅱ Pause";
  state.replayTimer = setInterval(() => {
    if (state.replayIndex >= state.imported.bars.length - 1) {
      clearInterval(state.replayTimer);
      state.replayTimer = null;
      $("replay-play").textContent = "▶ Play";
      return;
    }
    state.replayIndex++;
    updateReplay();
  }, +$("replay-speed").value);
});

function calcRisk() {
  const point = $("risk-symbol").value === "MES" ? 5 : 2,
    entry = +$("risk-entry").value,
    stop = +$("risk-stop").value,
    cost = Math.max(0, +$("risk-cost").value),
    open = Math.max(0, +$("risk-open").value),
    cap = Math.min(160, Math.max(0, +$("risk-cap").value)),
    available = Math.max(0, cap - open),
    per = Math.abs(entry - stop) * point + cost,
    qty = per > 0 ? Math.floor(available / per) : 0,
    total = qty * per,
    allowed = qty > 0;
  $("risk-badge").textContent = allowed ? "ALLOWED" : "REJECTED";
  $("risk-badge").className = "badge " + (allowed ? "green" : "red");
  $("risk-qty").textContent = qty + " contract" + (qty === 1 ? "" : "s");
  $("risk-summary").textContent = allowed
    ? `Maximum planned loss ${fmt(total)} fits the remaining budget. Net dollar target $162.50 stays inside the $160–165 band.`
    : "One contract cannot fit within the remaining risk budget — v5 would refine the entry to a 15M zone inside the 1H.";
  $("risk-breakdown").innerHTML =
    `<div><small>RISK / CONTRACT</small><b>$${fmt(per)}</b></div><div><small>AVAILABLE BUDGET</small><b>$${fmt(available)}</b></div><div><small>STOP DISTANCE</small><b>${fmt(Math.abs(entry - stop))} pts</b></div><div><small>EFFECTIVE CAP</small><b>$${fmt(cap)}</b></div>`;
}
document
  .querySelectorAll("#risk select,#risk input")
  .forEach((x) => x.addEventListener("input", calcRisk));
calcRisk();

async function loadEvents() {
  try {
    const response = await fetch("/api/events");
    if (!response.ok) throw new Error("Calendar unavailable");
    const data = await response.json();
    state.events = data.events || [];
    state.eventStatus = "READY";
    $("events-source").textContent = data.source;
    $("events-list").innerHTML =
      state.events
        .map(
          (e) =>
            `<div class="event-row"><time>${new Date(e.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time><div><b>${e.name}</b><span>${e.publisher} · ${e.note}</span></div><span class="badge amber">HIGH IMPACT</span></div>`,
        )
        .join("") ||
      '<div class="empty">No verified upcoming events returned.</div>';
    const next = state.events.find((e) => new Date(e.time) > new Date());
    if (next) {
      const delta = new Date(next.time) - Date.now(),
        days = Math.floor(delta / 86400000),
        hours = Math.floor((delta % 86400000) / 3600000);
      $("next-event").innerHTML =
        `<b>${next.name}</b><span>${new Date(next.time).toLocaleString()} · in ${days}d ${hours}h</span><span>${next.publisher} · 30-minute lock before and after</span>`;
    }
  } catch (e) {
    state.eventStatus = "ERROR";
    $("events-source").textContent = "LOCKED";
    $("events-list").innerHTML =
      '<div class="empty">Public calendar adapter unavailable. The news gate is locked until coverage returns.</div>';
  }
}
window.aegisApp = {
  getEval: (symbol) => state.evals[symbol],
  getStack: (symbol) => state.stacks[symbol],
  getInter: (symbol) => state.inter[symbol],
};
loadEvents();
loadFeeds();
loadHistory();
