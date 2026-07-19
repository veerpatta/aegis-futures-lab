#!/usr/bin/env python3
"""
Aegis paper-trading signal engine.

Runs on a schedule (GitHub Actions cron). Each run:
  1. Pulls recent candles for NQ=F / ES=F from yfinance (free, no key).
  2. Detects supply/demand zones on higher timeframes (Daily, 1H).
  3. Upserts those zones into Supabase.
  4. Checks the latest 15m candle for zone-reaction entries.
  5. Writes any new signals to Supabase (de-duped) and logs the run.

Data note: yfinance is unofficial and slightly delayed. Paper trading /
analysis only -- do NOT trade real money against these signals.

Env vars (set as GitHub Actions secrets):
  SUPABASE_URL          e.g. https://bizgcoljagsnytrnaicr.supabase.co
  SUPABASE_SERVICE_KEY  service_role key (Settings -> API -> service_role)
  SYMBOLS               optional, comma list. default "NQ=F,ES=F"
  RR                    optional reward:risk. default 2.0
  DRY_RUN               optional "1" -> compute + print, write nothing
"""

import os
import sys
import time
import json
from datetime import datetime, timezone

import requests
import pandas as pd
import yfinance as yf

# ----------------------------- config -----------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SYMBOLS = [s.strip() for s in os.environ.get("SYMBOLS", "NQ=F,ES=F").split(",") if s.strip()]
RR = float(os.environ.get("RR", "2.0"))
DRY_RUN = os.environ.get("DRY_RUN", "0") == "1"

# swing detection window (candles on each side of a pivot)
SWING_WINDOW = 3
# buffer beyond the zone edge for the stop, as a fraction of zone height
STOP_BUFFER_FRAC = 0.15
# only keep zones formed within this many HTF candles of "now"
MAX_ZONE_AGE = {"1d": 60, "1h": 120}


def log(msg):
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


# --------------------------- supabase REST ------------------------------

def _headers():
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def sb_upsert(table, rows, on_conflict, resolution="merge-duplicates"):
    """POST rows to PostgREST with upsert semantics. Returns inserted/updated rows."""
    if DRY_RUN:
        log(f"DRY_RUN upsert {table}: {json.dumps(rows)[:400]}")
        return rows
    if not rows:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    h = _headers()
    h["Prefer"] = f"resolution={resolution},return=representation"
    r = requests.post(url, headers=h, data=json.dumps(rows), timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"upsert {table} failed {r.status_code}: {r.text}")
    return r.json()


def sb_select(table, params=""):
    if DRY_RUN and not SERVICE_KEY:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.get(url, headers=_headers(), timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"select {table} failed {r.status_code}: {r.text}")
    return r.json()


# --------------------------- market data --------------------------------

def fetch(symbol, interval, period):
    """Return a clean OHLC DataFrame indexed by UTC timestamp."""
    df = yf.download(
        symbol, interval=interval, period=period,
        auto_adjust=False, progress=False, threads=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance may return a MultiIndex on columns for a single ticker
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.title)[["Open", "High", "Low", "Close"]].dropna()
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    return df


# --------------------------- zone detection -----------------------------

def detect_zones(symbol, timeframe, df):
    """
    Fractal swing zones.
    A swing high (SWING_WINDOW bars higher on both sides) seeds a SUPPLY zone
    spanning that candle's [max(open,close) .. high].
    A swing low seeds a DEMAND zone spanning [low .. min(open,close)].
    """
    zones = []
    n = len(df)
    if n < 2 * SWING_WINDOW + 1:
        return zones
    highs, lows = df["High"].values, df["Low"].values
    opens, closes = df["Open"].values, df["Close"].values
    times = df.index

    max_age = MAX_ZONE_AGE.get(timeframe, 60)
    start = max(SWING_WINDOW, n - max_age)

    for i in range(start, n - SWING_WINDOW):
        window_h = highs[i - SWING_WINDOW:i + SWING_WINDOW + 1]
        window_l = lows[i - SWING_WINDOW:i + SWING_WINDOW + 1]
        body_hi = max(opens[i], closes[i])
        body_lo = min(opens[i], closes[i])
        ts = times[i].to_pydatetime().isoformat()

        if highs[i] == window_h.max():
            zones.append({
                "symbol": symbol, "timeframe": timeframe, "zone_type": "supply",
                "price_high": round(float(highs[i]), 4),
                "price_low": round(float(body_hi), 4),
                "source_candle_ts": ts, "status": "fresh",
            })
        if lows[i] == window_l.min():
            zones.append({
                "symbol": symbol, "timeframe": timeframe, "zone_type": "demand",
                "price_high": round(float(body_lo), 4),
                "price_low": round(float(lows[i]), 4),
                "source_candle_ts": ts, "status": "fresh",
            })
    return zones


# --------------------------- signal logic -------------------------------

def check_entries(symbol, zones, exec_df):
    """
    On the most recent CLOSED 15m candle:
      demand -> long if the candle's low taps the zone and it closes back above.
      supply -> short if the candle's high taps the zone and it closes back below.
    """
    signals = []
    if exec_df.empty or not zones:
        return signals
    c = exec_df.iloc[-1]
    ts = exec_df.index[-1].to_pydatetime().isoformat()
    low, high, close = float(c["Low"]), float(c["High"]), float(c["Close"])

    for z in zones:
        zh, zl = float(z["price_high"]), float(z["price_low"])
        zid = z.get("id")
        height = max(zh - zl, 1e-9)
        if z["zone_type"] == "demand" and low <= zh and close > zh:
            stop = zl - height * STOP_BUFFER_FRAC
            risk = close - stop
            if risk <= 0:
                continue
            signals.append(_sig(symbol, "long", close, stop, close + RR * risk, zid, ts,
                                f"15m tap+reclaim of {z['timeframe']} demand zone"))
        elif z["zone_type"] == "supply" and high >= zl and close < zl:
            stop = zh + height * STOP_BUFFER_FRAC
            risk = stop - close
            if risk <= 0:
                continue
            signals.append(_sig(symbol, "short", close, stop, close - RR * risk, zid, ts,
                                f"15m tap+reject of {z['timeframe']} supply zone"))
    return signals


def _sig(symbol, direction, entry, stop, target, zone_id, ts, reason):
    return {
        "symbol": symbol, "timeframe": "15m", "direction": direction,
        "entry_price": round(entry, 4), "stop_price": round(stop, 4),
        "target_price": round(target, 4), "rr": RR, "zone_id": zone_id,
        "reason": reason, "signal_ts": ts, "status": "pending",
    }


# ------------------------------- main -----------------------------------

def run():
    t0 = time.time()
    if not SUPABASE_URL or (not SERVICE_KEY and not DRY_RUN):
        log("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.")
        sys.exit(1)

    total_zones, total_signals = 0, 0
    for symbol in SYMBOLS:
        log(f"=== {symbol} ===")
        htf = {"1d": fetch(symbol, "1d", "1y"), "1h": fetch(symbol, "1h", "3mo")}
        exec_df = fetch(symbol, "15m", "5d")

        stored = []
        for tf, df in htf.items():
            zs = detect_zones(symbol, tf, df)
            log(f"{tf}: {len(df)} candles -> {len(zs)} zones")
            saved = sb_upsert("zones", zs,
                              on_conflict="symbol,timeframe,zone_type,price_high,price_low")
            stored.extend(saved or zs)
            total_zones += len(zs)

        # pull back active zones (with ids) so signals can reference them
        if not DRY_RUN:
            stored = sb_select(
                "zones",
                f"symbol=eq.{symbol}&status=in.(fresh,tested)&select=id,zone_type,timeframe,price_high,price_low",
            )
        sigs = check_entries(symbol, stored, exec_df)
        log(f"15m: {len(exec_df)} candles -> {len(sigs)} candidate signals")
        if sigs:
            written = sb_upsert("signals", sigs,
                                on_conflict="symbol,direction,zone_id,signal_ts",
                                resolution="ignore-duplicates")
            total_signals += len(written or [])

    dur = int((time.time() - t0) * 1000)
    log(f"Done: {total_zones} zones, {total_signals} signals in {dur} ms")
    sb_upsert("engine_runs", [{
        "status": "ok", "symbols": SYMBOLS, "zones_upserted": total_zones,
        "signals_created": total_signals, "duration_ms": dur,
        "message": "dry-run" if DRY_RUN else "scheduled run",
    }], on_conflict="id", resolution="merge-duplicates")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:  # noqa
        log(f"ERROR: {e}")
        try:
            sb_upsert("engine_runs", [{"status": "error", "message": str(e)[:500]}],
                      on_conflict="id")
        except Exception:
            pass
        sys.exit(1)
