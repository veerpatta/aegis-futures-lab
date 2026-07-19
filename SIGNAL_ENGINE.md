# Aegis — paper-trading signal engine

A $0 signal engine for MNQ/MES paper trading. Pulls futures candles from
yfinance, detects supply/demand zones on Daily + 1H, checks 15m for entries,
and writes signals to Supabase. Scheduled by GitHub Actions cron.

**Data is delayed and unofficial (yfinance). Paper trading and analysis only —
do not trade real money against these signals.**

## What's in here

```
signal_engine.py                  # the engine
requirements.txt                  # yfinance, pandas, requests
.env.example                      # local-run template
.github/workflows/signal-engine.yml  # 15-min cron during the NY session
```

## Supabase (already done)

Schema is live in the **Trading Bot Aegis** project
(`https://bizgcoljagsnytrnaicr.supabase.co`). Tables:

- `zones` — detected supply/demand zones (upserted idempotently)
- `signals` — emitted trade signals (de-duped per symbol/direction/zone/candle)
- `trades` — trade journal for Topstep/Tradovate CSV import
- `engine_runs` — one row per engine run, for monitoring

RLS is on: the dashboard reads with the **anon/publishable** key; the engine
writes with the **service_role** key (bypasses RLS). The browser may `insert`
into `trades` for CSV upload.

## Wiring up GitHub (the part that needs you)

1. Create a repo (public = unlimited Actions minutes) and add these files at the root.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**. Add two:
   - `SUPABASE_URL` = `https://bizgcoljagsnytrnaicr.supabase.co`
   - `SUPABASE_SERVICE_KEY` = your **service_role** key from Supabase
     **Settings → API → Project API keys → service_role** (secret; never commit it)
3. Push. Go to the **Actions** tab → **signal-engine** → **Run workflow** to trigger a manual run, then confirm rows appear in `engine_runs` and `zones`.

The cron `*/15 13-20 * * 1-5` runs every 15 min on weekdays, ~09:30–16:00 ET.
GitHub cron is UTC and can be delayed 5–15 min — fine for logging paper signals,
not for live execution.

## Run locally

```bash
pip install -r requirements.txt
cp .env.example .env          # fill in SUPABASE_SERVICE_KEY
export $(grep -v '^#' .env | xargs)
python signal_engine.py

# compute + print without writing anything:
DRY_RUN=1 SUPABASE_URL=x python signal_engine.py
```

## Strategy knobs (top of signal_engine.py)

- `SWING_WINDOW` — pivot sensitivity for zone detection (default 3)
- `STOP_BUFFER_FRAC` — stop distance beyond the zone edge (default 15%)
- `RR` — reward:risk for the target (default 2.0, via env)
- `MAX_ZONE_AGE` — how far back to keep zones per timeframe

## Historical backfill (optional, later)

For multi-year MNQ/MES bars, Databento gives new accounts ~$125 free credits —
enough for a one-time pull. yfinance caps 1m at ~7 days, 15m at ~60 days,
1h at ~2 years, daily unlimited.
