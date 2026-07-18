/* Aegis Strategy v5 engine — Brendan Wendell demand & supply, price action only.
   Shared by the dashboard (app.js), the paper agent (agent.js) and the
   30/40/60-day outcome study (outcomes.js).

   v5 spec highlights implemented here:
   - Four institutional patterns: DBR, RBR, RBD, DBD (1–2 base candles).
   - Wick-tolerance qualification path for single-departure zones.
   - Gap conversion: leg direction is measured close-to-close, so session
     gaps are internally converted to Rally/Drop movement.
   - Daily zone layer including reaction zones (context, non-entry).
   - Strict rectangle containment Daily→4H→1H, with 4H promoted to
     primary HTF when no Daily zone is in range.
   - Risk-adaptive entry: 1H when the structural stop fits $160,
     otherwise 15M refinement inside the 1H zone.
   - Freshness (first return only), achievement upgrade, weak-zone and
     New York 1H caution rules.
   - Symmetric 80% first-counter-zone block after an HTF reaction.
   - Old directional-alignment engine kept as a labelled comparison mode. */
(function (global) {
  "use strict";

  const TF_RANK = { D: 0, 240: 1, 60: 2, 15: 3 };
  const TF_LABEL = { D: "Daily", 240: "4H", 60: "1H", 15: "15M" };
  const DEFAULT_CONFIG = {
    maxRisk: 160, // $ absolute, fees + slippage included
    targetNet: 162.5, // $ net default inside the $160–165 gross band
    cost: 2.4, // fees + slippage per contract, round trip
    slippage: 0.25, // points added to entry fills
    stopBuffer: 0.25, // points beyond the distal line
    freshGraceSec: 0, // live callers allow the in-progress first return
  };

  const nyCache = new Map();
  const NY_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  function nyMeta(time) {
    const key = Math.floor(time / 60);
    let meta = nyCache.get(key);
    if (!meta) {
      const parts = NY_FMT.formatToParts(new Date(time * 1000)).reduce(
        (a, p) => ((a[p.type] = p.value), a),
        {},
      );
      meta = {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
        weekday: parts.weekday,
      };
      nyCache.set(key, meta);
    }
    return meta;
  }

  function pointValue(symbol) {
    return symbol === "MES" ? 5 : 2;
  }

  function aggregateMinutes(bars, minutes) {
    const span = minutes * 60,
      out = [];
    for (const b of bars) {
      const time = Math.floor(b.time / span) * span,
        last = out[out.length - 1];
      if (last && last.time === time) {
        last.high = Math.max(last.high, b.high);
        last.low = Math.min(last.low, b.low);
        last.close = b.close;
        last.volume = (last.volume || 0) + (b.volume || 0);
        last.endTime = b.time;
      } else
        out.push({
          time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume || 0,
          endTime: b.time,
        });
    }
    return out;
  }
  function aggregateDaily(bars) {
    const out = [];
    for (const b of bars) {
      const date = nyMeta(b.time).date,
        last = out[out.length - 1];
      if (last && last.date === date) {
        last.high = Math.max(last.high, b.high);
        last.low = Math.min(last.low, b.low);
        last.close = b.close;
        last.volume = (last.volume || 0) + (b.volume || 0);
        last.endTime = b.time;
      } else
        out.push({
          date,
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume || 0,
          endTime: b.time,
        });
    }
    return out;
  }

  /* Candle grammar. Leg direction uses close-to-close movement so an
     overnight gap is converted into ordinary Rally/Drop movement (§1.2). */
  function candleMeta(bars) {
    const metas = new Array(bars.length);
    let rollSum = 0;
    const window = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i],
        prev = bars[i - 1] || null,
        range = Math.max(1e-9, b.high - b.low),
        body = Math.abs(b.close - b.open),
        prevClose = prev ? prev.close : b.open,
        gap = b.open - prevClose,
        effMove = b.close - prevClose,
        avg = window.length ? rollSum / window.length : range;
      const a = Math.max(avg, 1e-9);
      metas[i] = {
        index: i,
        bar: b,
        range,
        body,
        gap,
        effMove,
        avg: a,
        dir: effMove > 0 ? 1 : effMove < 0 ? -1 : 0,
        strong: Math.abs(effMove) >= 0.7 * a, // departure-grade leg candle
        leg: Math.abs(effMove) >= 0.55 * a, // arrival-grade leg candle
        base: Math.abs(effMove) <= 0.5 * a,
        gapConverted: prev ? Math.abs(gap) > 0.3 * a : false,
      };
      window.push(range);
      rollSum += range;
      if (window.length > 14) rollSum -= window.shift();
    }
    return metas;
  }

  /* §1.1 — detect DBR / RBR / RBD / DBD zones on one timeframe. */
  function detectZones(frameBars, tf, execResolutionSec) {
    const metas = candleMeta(frameBars),
      zones = [];
    let rejected = 0;
    for (let i = 1; i < frameBars.length - 1; i++) {
      if (!metas[i].base || metas[i - 1].base) continue; // base run starts here
      let end = i;
      if (metas[i + 1] && metas[i + 1].base && i + 1 < frameBars.length - 1)
        end = i + 1; // at most 2 base candles
      const arrival = metas[i - 1],
        departure = metas[end + 1];
      if (!departure || !arrival.leg || !departure.strong || !departure.dir) {
        if (departure && arrival.leg) rejected++;
        continue;
      }
      const type = departure.dir > 0 ? "demand" : "supply",
        pattern =
          (arrival.dir >= 0 ? "R" : "D") + "B" + (departure.dir > 0 ? "R" : "D"),
        baseCandles = frameBars.slice(i, end + 1);
      // Wick tolerance path (§1.1): a single strong departure candle keeps
      // the zone valid when a base candle carries a relatively large wick.
      const follow = metas[end + 2],
        multiDeparture =
          !!follow && follow.strong && follow.dir === departure.dir,
        largeBaseWick = baseCandles.some((c) => {
          const r = Math.max(1e-9, c.high - c.low);
          return type === "demand"
            ? (Math.min(c.open, c.close) - c.low) / r > 0.5
            : (c.high - Math.max(c.open, c.close)) / r > 0.5;
        });
      let wickTolerance = false;
      if (!multiDeparture && Math.abs(departure.effMove) < 1.0 * departure.avg) {
        if (largeBaseWick) wickTolerance = true;
        else {
          rejected++; // structure does not match a qualified pattern
          continue;
        }
      }
      let proximal, distal;
      if (type === "demand") {
        distal = Math.min(...baseCandles.map((c) => c.low));
        proximal = Math.max(...baseCandles.map((c) => Math.max(c.open, c.close)));
      } else {
        distal = Math.max(...baseCandles.map((c) => c.high));
        proximal = Math.min(...baseCandles.map((c) => Math.min(c.open, c.close)));
      }
      const height = Math.abs(distal - proximal);
      if (height <= 0) continue;
      const arrivalCandles = frameBars.slice(i - 1, end + 1);
      zones.push({
        tf,
        tfRank: TF_RANK[tf],
        type,
        pattern,
        proximal,
        distal,
        low: Math.min(proximal, distal),
        high: Math.max(proximal, distal),
        height,
        baseCount: end - i + 1,
        wickTolerance,
        wide: height > 2 * departure.avg, // §1.1: refine on 15M when too wide
        gapConverted:
          arrival.gapConverted || departure.gapConverted || metas[i].gapConverted,
        arrivalTime: frameBars[i - 1].time,
        arrivalExtreme:
          type === "demand"
            ? Math.min(...arrivalCandles.map((c) => c.low))
            : Math.max(...arrivalCandles.map((c) => c.high)),
        formedAt:
          (frameBars[end + 1].endTime ?? frameBars[end + 1].time) +
          (execResolutionSec || 300),
        firstReturnAt: null,
        brokenAt: null,
        achievedAt: null,
        reaction: false,
        blocked80: null,
      });
    }
    return { zones, rejected };
  }

  /* Timestamped life-cycle annotations against the execution series, so a
     backtest walking forward never reads information from the future. */
  function annotateZones(zones, execBars, buffer) {
    const pad = buffer ?? 0.25;
    for (const z of zones) {
      let firstReturn = null,
        visitEnd = null,
        broken = null,
        achieved = null;
      for (let i = 0; i < execBars.length; i++) {
        const b = execBars[i];
        if (b.time < z.formedAt) continue;
        if (z.type === "demand") {
          if (firstReturn === null && b.low <= z.proximal) firstReturn = b.time;
          else if (firstReturn !== null && visitEnd === null && b.low > z.proximal)
            visitEnd = b.time; // price left the zone — first visit over
          if (broken === null && b.low < z.distal - pad) broken = b.time;
          if (
            achieved === null &&
            firstReturn === null &&
            b.high >= z.proximal + 2 * z.height
          )
            achieved = b.time; // structure/opposing-zone break proxy (§3.2)
        } else {
          if (firstReturn === null && b.high >= z.proximal) firstReturn = b.time;
          else if (firstReturn !== null && visitEnd === null && b.high < z.proximal)
            visitEnd = b.time;
          if (broken === null && b.high > z.distal + pad) broken = b.time;
          if (
            achieved === null &&
            firstReturn === null &&
            b.low <= z.proximal - 2 * z.height
          )
            achieved = b.time;
        }
        if (visitEnd !== null && broken !== null) break;
      }
      z.firstReturnAt = firstReturn;
      z.firstVisitEndAt = visitEnd;
      z.brokenAt = broken;
      z.achievedAt = achieved;
    }
  }

  /* §1.3 — reaction zones: formed while price was reacting to an older
     same-side zone. Marked on every timeframe; context, never an entry. */
  function tagReactionZones(allZones) {
    for (const z of allZones) {
      z.reaction = allZones.some(
        (o) =>
          o !== z &&
          o.type === z.type &&
          o.tfRank <= z.tfRank &&
          o.formedAt < z.arrivalTime &&
          (o.brokenAt === null || o.brokenAt > z.formedAt) &&
          (z.type === "demand"
            ? z.arrivalExtreme <= o.proximal &&
              z.arrivalExtreme >= o.distal - 0.5 * o.height
            : z.arrivalExtreme >= o.proximal &&
              z.arrivalExtreme <= o.distal + 0.5 * o.height),
      );
    }
  }

  /* §4 — symmetric 80% rule. After price reacts from an HTF zone, the first
     opposing-side zone formed afterwards is tagged blocked_first_counter_zone. */
  function tagBlocked80(zonesByTf) {
    const events = [];
    for (const tf of ["D", "240"])
      for (const z of zonesByTf[tf] || [])
        if (z.firstReturnAt !== null && z.brokenAt === null)
          events.push({
            time: z.firstReturnAt,
            counterSide: z.type === "supply" ? "demand" : "supply",
            source: `${TF_LABEL[z.tf]} ${z.type} reaction`,
          });
    events.sort((a, b) => a.time - b.time);
    for (const ev of events)
      for (const tf of ["240", "60", "15"]) {
        let first = null;
        for (const z of zonesByTf[tf] || [])
          if (
            z.type === ev.counterSide &&
            z.formedAt > ev.time &&
            (!first || z.formedAt < first.formedAt)
          )
            first = z;
        if (first && !first.blocked80)
          first.blocked80 = { at: first.formedAt, source: ev.source };
      }
  }

  /* Build the full multi-timeframe stack from an execution series
     (5-minute preferred; 1-minute imports are aggregated first). */
  function buildStack(inputBars) {
    const exec = aggregateMinutes(inputBars, 5);
    const frames = {
      D: aggregateDaily(exec),
      240: aggregateMinutes(exec, 240),
      60: aggregateMinutes(exec, 60),
      15: aggregateMinutes(exec, 15),
    };
    const zones = {},
      rejects = {};
    for (const tf of Object.keys(frames)) {
      const r = detectZones(frames[tf], tf, 300);
      zones[tf] = r.zones;
      rejects[tf] = r.rejected;
      annotateZones(zones[tf], exec, 0.25);
    }
    const all = [].concat(zones.D, zones["240"], zones["60"], zones["15"]);
    tagReactionZones(all);
    tagBlocked80(zones);
    return { exec, frames, zones, rejects, all };
  }

  /* Strict rectangle containment (§2.2) with a small tolerance for the
     refinement wicks that sit just outside the parent rectangle. */
  function contains(parent, child) {
    const eps = Math.max(0.5, 0.15 * (parent.high - parent.low));
    return child.low >= parent.low - eps && child.high <= parent.high + eps;
  }

  function visible(z, time) {
    return z.formedAt <= time;
  }
  function alive(z, time) {
    return z.brokenAt === null || z.brokenAt > time;
  }
  /* §3.1 freshness: the zone is tradeable until its FIRST visit ends —
     the first return may last several candles (and §5.2 fast approaches
     deliberately enter deep into that visit, after the first touch). */
  function freshAt(z, time, graceSec) {
    if (z.firstReturnAt === null) return true;
    const visitEnd = z.firstVisitEndAt === null ? Infinity : z.firstVisitEndAt;
    return time <= visitEnd + (graceSec || 0);
  }
  function achievedBy(z, time) {
    return z.achievedAt !== null && z.achievedAt <= time;
  }
  function blockedBy(z, time) {
    return !!z.blocked80 && z.blocked80.at <= time;
  }
  function distanceTo(z, price) {
    if (price >= z.low && price <= z.high) return 0;
    return price < z.low ? z.low - price : price - z.high;
  }
  function inRange(z, price) {
    return distanceTo(z, price) <= 2 * (z.high - z.low);
  }
  function priceInside(z, price) {
    return z.type === "demand"
      ? price <= z.proximal + 0.25 && price >= z.distal - 0.25
      : price >= z.proximal - 0.25 && price <= z.distal + 0.25;
  }

  function zoneScore(z, ctx) {
    let score = 55;
    if (ctx.achieved) score += 20;
    if (ctx.fresh) score += 10;
    if (z.pattern === "DBR" || z.pattern === "RBD") score += 5; // reversal patterns
    if (ctx.fullStack) score += 10;
    if (ctx.nyCaution) score -= 10;
    if (z.wickTolerance) score -= 5;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /* Risk-adaptive plan (§2.2 step 4 + §6): whole contracts from structural
     stop distance, $160 absolute risk, $162.50 net dollar target. */
  function planFromZone(zone, symbol, config) {
    const cfg = { ...DEFAULT_CONFIG, ...(config || {}) },
      point = pointValue(symbol),
      side = zone.type === "demand" ? "LONG" : "SHORT",
      entry =
        side === "LONG" ? zone.proximal + cfg.slippage : zone.proximal - cfg.slippage,
      stop =
        side === "LONG"
          ? zone.distal - cfg.stopBuffer
          : zone.distal + cfg.stopBuffer,
      stopPoints = Math.abs(entry - stop),
      perContract = stopPoints * point + cfg.cost,
      qty = perContract > 0 ? Math.floor(cfg.maxRisk / perContract) : 0;
    if (qty < 1)
      return { fits: false, side, entry, stop, stopPoints, perContract, qty: 0 };
    const targetPoints = (cfg.targetNet + cfg.cost * qty) / (point * qty),
      target = side === "LONG" ? entry + targetPoints : entry - targetPoints;
    return {
      fits: true,
      side,
      entry,
      stop,
      target,
      stopPoints,
      targetPoints,
      perContract,
      qty,
      risk: perContract * qty,
    };
  }

  /* Core evaluation for one symbol at one moment.
     mode: "strict" (v5 default, rectangle nesting) or
           "directional" (labelled v4 comparison run: same-side agreement only). */
  function evaluate(stack, opts) {
    const {
        symbol,
        time,
        price,
        mode = "strict",
        config,
      } = opts,
      cfg = { ...DEFAULT_CONFIG, ...(config || {}) },
      ny = nyMeta(time),
      result = {
        symbol,
        time,
        price,
        mode,
        side: null,
        htf: null,
        htfZone: null,
        fourH: null,
        oneH: null,
        entryZone: null,
        entryTf: null,
        refined15: false,
        nyCaution: false,
        plan: null,
        score: null,
        bucket: null,
        detail: "",
        atEntry: false,
      };

    // Reaction zones stay valid structure/containment context (§1.3);
    // only entry zones exclude them (§3.1) via the noReaction flag.
    const pick = (list, filter, noReaction) => {
      let best = null,
        bestKey = Infinity;
      for (const z of list)
        if (
          visible(z, time) &&
          alive(z, time) &&
          !(noReaction && z.reaction) &&
          (!filter || filter(z))
        ) {
          const key = distanceTo(z, price) - z.formedAt / 1e12; // nearest, then newest
          if (key < bestKey) {
            bestKey = key;
            best = z;
          }
        }
      return best;
    };

    // Directional pressure (§5.1) from the nearest HTF structure even when
    // no zone qualifies as an in-range traded HTF — used by the intermarket
    // confirmation on the opposite market.
    const nearestHtf =
      pick(stack.zones.D, null) ||
      pick(stack.zones["240"], null) ||
      pick(stack.zones["60"], null);
    result.pressureSide = nearestHtf
      ? nearestHtf.type === "demand"
        ? "LONG"
        : "SHORT"
      : null;

    // 1) HTF selection: Daily primary, 4H fallback (§2.1). Reaction zones
    //    still count as context/structure but are not used as the traded HTF.
    let htfZone = pick(stack.zones.D, (z) => inRange(z, price));
    let htf = "D";
    if (!htfZone) {
      htfZone = pick(stack.zones["240"], (z) => inRange(z, price));
      htf = "240";
    }
    if (!htfZone) {
      result.bucket = "noHtf";
      result.detail = "No valid Daily or 4H zone in the current price region";
      return result;
    }
    result.htf = htf;
    result.htfZone = htfZone;
    result.side = htfZone.type === "demand" ? "LONG" : "SHORT";

    // 2) Nested refinement (§2.2) — or directional agreement in v4 mode.
    let parentFor1h = htfZone;
    if (mode === "strict") {
      if (htf === "D") {
        const four = pick(
          stack.zones["240"],
          (z) => z.type === htfZone.type && contains(htfZone, z),
        );
        if (!four) {
          result.bucket = "nesting";
          result.detail = `No 4H ${htfZone.type} zone nested inside the Daily zone`;
          return result;
        }
        result.fourH = four;
        parentFor1h = four;
      }
      const oneH = pick(
        stack.zones["60"],
        (z) => z.type === htfZone.type && contains(parentFor1h, z),
        true,
      );
      if (!oneH) {
        result.bucket = "nesting";
        result.detail = `No 1H ${htfZone.type} zone nested inside the ${TF_LABEL[result.fourH ? "240" : htf]} zone`;
        return result;
      }
      result.oneH = oneH;
    } else {
      const four = pick(stack.zones["240"], (z) => z.type === htfZone.type);
      const oneH = pick(
        stack.zones["60"],
        (z) => z.type === htfZone.type,
        true,
      );
      if (!oneH) {
        result.bucket = "nesting";
        result.detail = "No same-direction 1H zone available";
        return result;
      }
      result.fourH = four;
      result.oneH = oneH;
    }

    const oneH = result.oneH;

    // 3) Entry-zone quality gates (§3, §4).
    if (blockedBy(oneH, time)) {
      result.entryZone = oneH;
      result.entryTf = "60";
      result.bucket = "blocked80";
      result.detail = `80% rule: first counter zone after ${oneH.blocked80.source}`;
      return result;
    }
    if (!freshAt(oneH, time, cfg.freshGraceSec)) {
      result.entryZone = oneH;
      result.entryTf = "60";
      result.bucket = "notFresh";
      result.detail = "1H zone already had its first return — no longer fresh";
      return result;
    }
    const achieved = achievedBy(oneH, time);
    const nyCaution = !achieved && ny.minutes >= 570; // §3.3 NY standalone caution
    result.nyCaution = nyCaution;
    if (mode === "directional" && nyCaution) {
      result.entryZone = oneH;
      result.entryTf = "60";
      result.bucket = "weakZone";
      result.detail =
        "Un-achieved standalone 1H zone in the New York session (weak-zone exclusion)";
      return result;
    }

    // 4) Risk-adaptive entry timeframe (§2.2 step 4).
    let entryZone = oneH,
      entryTf = "60",
      plan = planFromZone(oneH, symbol, cfg);
    if (!plan.fits) {
      const fifteen = pick(
        stack.zones["15"],
        (z) =>
          z.type === oneH.type &&
          contains(oneH, z) &&
          !blockedBy(z, time) &&
          freshAt(z, time, cfg.freshGraceSec),
        true,
      );
      const plan15 = fifteen ? planFromZone(fifteen, symbol, cfg) : null;
      if (fifteen && plan15 && plan15.fits) {
        entryZone = fifteen;
        entryTf = "15";
        plan = plan15;
        result.refined15 = true;
      } else {
        result.entryZone = oneH;
        result.entryTf = "60";
        result.bucket = "riskUnfit";
        result.detail = `1H stop $${plan.perContract.toFixed(0)}/contract exceeds $${cfg.maxRisk}; no fitting fresh 15M refinement`;
        return result;
      }
    }
    result.entryZone = entryZone;
    result.entryTf = entryTf;
    result.plan = plan;
    result.score = zoneScore(entryZone, {
      achieved,
      fresh: true,
      fullStack: mode === "strict" && htf === "D",
      nyCaution,
    });
    result.atEntry = priceInside(entryZone, price);
    result.detail = `${TF_LABEL[entryTf]} ${entryZone.pattern} ${entryZone.type} entry inside the ${TF_LABEL[htf]} zone`;
    return result;
  }

  /* §5 — intermarket rules. `mine`/`other` are evaluate() results;
     approach speed is measured on the entering market's exec bars. */
  function intermarketCheck(mine, other, otherSymbol, execBars) {
    if (!mine || !mine.side) return { pass: false, detail: "No qualified setup" };
    const otherSide = other ? other.side || other.pressureSide : null;
    if (!otherSide)
      return {
        pass: false,
        detail: `${otherSymbol} shows no directional pressure — no confirmation`,
      };
    if (otherSide !== mine.side)
      return {
        pass: false,
        detail: `MES and MNQ directional pressure disagree (${mine.side} vs ${otherSide})`,
      };
    // Speed of approach (§5.2): fast arrivals must reach the deep overlap.
    let speed = "slow";
    if (execBars && execBars.length >= 7 && mine.entryZone) {
      const recent = execBars.slice(-7),
        move = Math.abs(recent[recent.length - 1].close - recent[0].close),
        avgRange =
          recent.reduce((s, b) => s + (b.high - b.low), 0) / recent.length;
      if (move > 2.5 * Math.max(avgRange, 1e-9)) speed = "fast";
      if (speed === "fast" && mine.atEntry) {
        const z = mine.entryZone,
          deep =
            z.type === "demand"
              ? mine.price <= z.distal + z.height / 3
              : mine.price >= z.distal - z.height / 3;
        if (!deep)
          return {
            pass: false,
            speed,
            detail:
              "Fast approach: first zone likely fails — waiting for the deep MNQ/MES overlap area",
          };
      }
    }
    return {
      pass: true,
      speed,
      detail:
        speed === "fast"
          ? "Directional agreement · fast approach, deep overlap reached"
          : "Directional agreement · slow approach, own-zone entry valid",
    };
  }

  global.AegisV5 = {
    VERSION: "5.0",
    TF_LABEL,
    DEFAULT_CONFIG,
    nyMeta,
    pointValue,
    aggregateMinutes,
    aggregateDaily,
    detectZones,
    annotateZones,
    buildStack,
    contains,
    evaluate,
    intermarketCheck,
    planFromZone,
    zoneHelpers: { visible, alive, freshAt, achievedBy, blockedBy, priceInside, inRange },
  };
})(typeof window !== "undefined" ? window : globalThis);
