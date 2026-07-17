const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
const state = {
  symbol: "MES",
  feeds: { MES: null, MNQ: null },
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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce((a, p) => ((a[p.type] = p.value), a), {});
  const mins = (+parts.hour % 24) * 60 + +parts.minute;
  const weekday = !["Sat", "Sun"].includes(parts.weekday);
  const active = weekday && mins >= 570 && mins < 930;
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
    state.mode = "DELAYED";
    $("feed-chip").textContent = "FREE DELAYED";
    $("feed-chip").className = "chip amber";
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

function getBars(symbol = state.symbol) {
  if (
    state.mode === "REPLAY" &&
    state.imported &&
    state.imported.symbol === symbol
  )
    return state.imported.bars.slice(0, state.replayIndex + 1);
  return state.feeds[symbol]?.bars || [];
}
function detectStructure(bars) {
  const highs = [],
    lows = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const b = bars[i];
    if (
      b.high > bars[i - 1].high &&
      b.high >= bars[i - 2].high &&
      b.high > bars[i + 1].high &&
      b.high >= bars[i + 2].high
    )
      highs.push({ time: b.time, price: b.high });
    if (
      b.low < bars[i - 1].low &&
      b.low <= bars[i - 2].low &&
      b.low < bars[i + 1].low &&
      b.low <= bars[i + 2].low
    )
      lows.push({ time: b.time, price: b.low });
  }
  const h = highs.slice(-2),
    l = lows.slice(-2);
  let trend = "SIDEWAYS";
  if (
    h.length === 2 &&
    l.length === 2 &&
    h[1].price > h[0].price &&
    l[1].price > l[0].price
  )
    trend = "UPTREND";
  if (
    h.length === 2 &&
    l.length === 2 &&
    h[1].price < h[0].price &&
    l[1].price < l[0].price
  )
    trend = "DOWNTREND";
  return {
    trend,
    highs,
    lows,
    lastHigh: h.at(-1) || null,
    lastLow: l.at(-1) || null,
    sequence:
      trend === "UPTREND"
        ? "HH + HL"
        : trend === "DOWNTREND"
          ? "LH + LL"
          : "Mixed swings",
  };
}
function analyze(bars) {
  if (bars.length < 15) return null;
  const recent = bars.slice(-120),
    n = recent.length,
    meanX = (n - 1) / 2,
    meanY = recent.reduce((s, b) => s + b.close, 0) / n;
  let num = 0,
    den = 0;
  recent.forEach((b, i) => {
    num += (i - meanX) * (b.close - meanY);
    den += (i - meanX) ** 2;
  });
  const slope = num / den,
    ranges = recent
      .slice(-14)
      .map((b, i, a) =>
        Math.max(
          b.high - b.low,
          i ? Math.abs(b.high - a[i - 1].close) : 0,
          i ? Math.abs(b.low - a[i - 1].close) : 0,
        ),
      ),
    atr = ranges.reduce((a, b) => a + b, 0) / ranges.length,
    normalized = slope / (atr || 1),
    structure = detectStructure(recent),
    trend = structure.trend,
    window = recent.slice(-25),
    demand = window.reduce((a, b) => (b.low < a.low ? b : a), window[0]),
    supply = window.reduce((a, b) => (b.high > a.high ? b : a), window[0]),
    last = recent.at(-1),
    departure = Math.abs(last.close - recent.at(-6).close) / (atr || 1),
    freshness = Math.max(
      0,
      20 - window.filter((b) => b.low <= demand.low + atr * 0.25).length * 4,
    ),
    score = Math.max(
      35,
      Math.min(
        100,
        Math.round(
          45 +
            freshness +
            Math.min(20, departure * 5) +
            (trend !== "SIDEWAYS" ? 15 : 0),
        ),
      ),
    ),
    stale = Date.now() / 1000 - last.time > 20 * 60;
  return {
    trend,
    atr,
    score,
    demand: { low: demand.low, high: demand.low + atr * 0.55 },
    supply: { low: supply.high - atr * 0.55, high: supply.high },
    last,
    stale,
    sample: bars.length,
    normalized,
    structure,
  };
}
function aggregateBars(bars, minutes) {
  const span = minutes * 60,
    out = [];
  for (const b of bars) {
    const time = Math.floor(b.time / span) * span,
      last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume = (last.volume || 0) + (b.volume || 0);
    } else
      out.push({
        time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      });
  }
  return out;
}
function analyzeStrategy(bars) {
  if (bars.length < 15) return null;
  const one = analyze(bars),
    fiveBars = aggregateBars(bars, 5),
    hourBars = aggregateBars(bars, 60),
    five = analyze(fiveBars) || one,
    hour = analyze(hourBars) || analyze(aggregateBars(bars, 15)) || one,
    last = bars.at(-1),
    trend = hour.trend,
    atr = five.atr,
    demand = five.demand,
    supply = five.supply,
    zoneReturn =
      trend === "UPTREND"
        ? last.close <= demand.high + atr * 0.6
        : trend === "DOWNTREND"
          ? last.close >= supply.low - atr * 0.6
          : false,
    confirmation =
      trend === "UPTREND"
        ? last.close > last.open
        : trend === "DOWNTREND"
          ? last.close < last.open
          : false;
  return {
    trend,
    atr,
    score: five.score,
    demand,
    supply,
    last,
    stale: one.stale,
    sample: bars.length,
    normalized: hour.normalized,
    zoneReturn,
    confirmation,
    timeframes: { m1: bars.length, m5: fiveBars.length, h1: hourBars.length },
    hour,
    five,
    one,
  };
}

function renderMarket() {
  const data = state.feeds[state.symbol],
    bars = getBars(),
    analysis = analyzeStrategy(bars);
  state.analysis = analysis;
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
  renderAnalysis(analysis);
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
    state.chart.timeScale().fitContent();
  } else {
    setTimeout(() => renderChart(bars), 300);
  }
}

function renderAnalysis(a) {
  if (!a) {
    $("bias").textContent = "—";
    $("zone-score").textContent = "—";
    return;
  }
  $("bias").textContent = a.trend;
  $("bias-detail").textContent = `60m bias · ${a.timeframes.h1} bars`;
  $("zone-score").textContent = a.score;
  $("zone-detail").textContent = `5m zone · ${a.timeframes.m5} bars`;
  $("signal-trend").textContent = a.trend;
  $("signal-vol").textContent = fmt(a.atr) + " pts";
  $("signal-confidence").textContent = a.stale
    ? "STALE"
    : a.timeframes.h1 >= 15
      ? "HIGH"
      : "LIMITED";
  const ready =
      !a.stale &&
      a.score >= 80 &&
      a.trend !== "SIDEWAYS" &&
      a.zoneReturn &&
      a.confirmation,
    armed = $("agent-chip").textContent.includes("ARMED");
  $("gate-badge").textContent = a.stale
    ? "DATA LOCK"
    : ready
      ? "PAPER READY"
      : armed
        ? "AGENT WAITING"
        : "MONITORING";
  $("gate-badge").className =
    "badge " + (a.stale ? "red" : ready ? "green" : "amber");
  $("gate-copy").className = "gate " + (ready ? "allowed" : "");
  $("gate-copy").innerHTML = a.stale
    ? "<b>Data is stale; all agent actions are paused</b><span>Fresh candles are required before strategy evaluation resumes.</span>"
    : ready
      ? "<b>Paper setup passes the strategy pipeline</b><span>The armed agent may simulate this setup. Real-money execution remains locked because this is a delayed research feed.</span>"
      : `<b>${armed ? "Paper agent is armed and waiting" : "Strategy monitor is active"}</b><span>No override is needed. The agent will act automatically only when 60m bias, 5m zone quality, zone return and 1m confirmation all pass.</span>`;
  const rules = [
    ["60m trend bias", a.trend !== "SIDEWAYS", a.trend],
    ["5m zone quality", a.score >= 80, `${a.score}/100`],
    [
      "Price at 5m zone",
      a.zoneReturn,
      a.zoneReturn ? "Inside tolerance" : "Waiting for return",
    ],
    [
      "1m confirmation",
      a.confirmation,
      a.confirmation ? "Direction confirmed" : "Waiting for candle",
    ],
    [
      "Data freshness",
      !a.stale,
      a.stale ? "Older than 20 minutes" : "Within threshold",
    ],
  ];
  $("checks").innerHTML = rules
    .map(
      (r) =>
        `<div class="check"><span>${r[0]}<small> · ${r[2]}</small></span><b class="${r[1] ? "pass" : "fail"}">${r[1] ? "PASS" : "WAIT"}</b></div>`,
    )
    .join("");
  $("zone-list").innerHTML =
    `<div class="zone-item"><div><b>${state.symbol} demand · 5m</b><span>${fmt(a.demand.low)} – ${fmt(a.demand.high)} · 60m bias ${a.trend}</span></div><strong class="${a.score >= 80 ? "positive" : ""}">${a.score}</strong></div><div class="zone-item"><div><b>${state.symbol} supply · 5m</b><span>${fmt(a.supply.low)} – ${fmt(a.supply.high)} · ${a.zoneReturn ? "price in tolerance" : "awaiting return"}</span></div><strong class="${a.score >= 80 ? "positive" : ""}">${a.score}</strong></div>`;
  $("audit-body").innerHTML = rules
    .map(
      (r) =>
        `<tr><td>${r[0]}</td><td class="${r[1] ? "positive" : ""}">${r[1] ? "PASS" : "WAIT"}</td><td>${r[2]}</td></tr>`,
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
    ? `Maximum planned loss ${fmt(total)} fits the remaining budget.`
    : "One contract cannot fit within the remaining risk budget.";
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
loadEvents();
loadFeeds();
