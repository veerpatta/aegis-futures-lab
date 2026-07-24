-- Fill-realism audit (2026-07-24).
--
-- Engine signals assume a resting limit order at the zone proximal fills
-- when price touches it — optimistic on delayed 5m bars (no queue priority,
-- no depth). The engine now classifies every fill by how convincingly the
-- bar path supports it (scripts/engine/fill-audit.ts):
--   clean    — the bar traded through the limit by ≥ 1 tick
--   marginal — touch/thin penetration, but the level was revisited later
--   doubtful — touch-only, never revisited; a real fill is unlikely
-- Bookkeeping only; trades stay untouched.

alter table public.signals add column if not exists fill_confidence text;
