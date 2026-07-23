-- DB hygiene + regime tag (2026-07-23).
--
-- Foreign-key columns signals.zone_id and trades.signal_id had no indexes,
-- so the FK checks on zone deletes (every engine pass prunes zones) walked
-- the tables sequentially.
--
-- signals.regime is bookkeeping, not a filter: the engine stamps each
-- signal with the market regime at entry time (trend/range × high/low
-- volatility, computed deterministically from 1H-aggregated bars — see
-- scripts/engine/regime.ts) so the dashboard can split performance by
-- regime. Strategy logic is untouched.

create index if not exists signals_zone_id_idx on public.signals (zone_id);
create index if not exists trades_signal_id_idx on public.trades (signal_id);

alter table public.signals add column if not exists regime text;
