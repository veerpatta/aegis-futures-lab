# Aegis Futures Lab — instructions for Claude

## Keep the user manual in sync (standing rule)

Three artifacts describe the app to a non-technical trader and MUST stay consistent
with each other and with the app:

1. `app/guide/page.tsx` — the in-app Guide page (source of truth for wording)
2. `docs/USER-MANUAL.md` — the same content as markdown
3. `docs/user-manual.pdf` — generated from the markdown

Whenever a change alters what a user sees or does — a new page, a renamed page, a
changed signal field/status, new tiers or tier rules, a changed daily routine, new
journal/import behavior — update the Guide page AND `docs/USER-MANUAL.md` in the same
commit, regenerate `docs/user-manual.pdf` from the markdown, and bump the "matches the
app as of <date>" line at the bottom of both documents. Purely internal refactors
(no user-visible change) do not require a manual update.

Regenerate the PDF with `node scripts/docs/build-manual-pdf.mjs` (renders the markdown
to a plain A4 print sheet and drives headless Chrome; `KEEP_HTML=1` keeps the
intermediate HTML when the markdown grows a construct the small converter misses).

Writing style for all three: plain trading language, no tech jargon, sentence case,
short sentences. The reader knows trading but not software. Always keep the
"nothing here touches real money / delayed data" warning prominent.

## Repo facts

- Routes: `/` is the Home dashboard (`components/home/HomeClient.tsx`), the Strategy Lab
  lives at `/lab`, and `/replay` is labelled "Journal" in the nav. `components/nav/links.tsx`
  splits `NAV_LINKS` (sidebar + the five `mobile: true` tab-bar entries) from
  `SECONDARY_LINKS` (Compare, Data — sidebar "More" group only).
- Times on screen follow a global ET/IST switch (`components/providers/ZoneProvider.tsx`,
  `lib/time/zones.ts`), persisted per device and defaulting to IST for Asia/Kolkata
  browsers. Two things stay ET on purpose: signals group by New York trading day
  (`nyMeta().dateKey`), and journal entry times are typed in ET to match the chart.
  Fixed session rules print both clocks via `etTimeLabel`/`etWindowLabel`, computed from
  the current US DST state — never hardcode the 9h30m gap (`tests/zones.test.ts` pins
  both halves of the year).
- The engine's live tier configuration lives in `scripts/engine/tiers.ts`; the
  scheduled runner is `scripts/engine/run-live.ts` (GitHub Actions,
  `.github/workflows/signal-engine.yml`, Node 22 required). `EXECUTION` is
  DERIVED from `lib/costs/` rather than hardcoded. Its scalars are still
  `{cost: 2.4, slippage: 0.25}` — `REALISTIC_MODEL` carries the same $1.20/side
  and the same one tick as `LEGACY_MODEL`. What changed on 2026-08-17 is where
  and how often they are charged: `EXECUTION` now also carries
  `minStopPoints: 2.0`, `restingLimitOrders: true` and a REALISTIC
  `FrictionSpec` (both sides slipped, 1.5x at the session edges, gapped stops
  filled at the open, one exit's slippage inside the sizing risk).
  `tests/costs.test.ts` pins the scalars AND the corrections, so dropping one
  silently reverts the live engine to the book Phase 1 refuted while the
  published figures keep describing the corrected one.
- Every behaviour-changing correction is a PARAM WHOSE DEFAULT IS LEGACY, and
  the live config opts in. `ExecutionConfig`: `minStopPoints`,
  `restingLimitOrders`, `friction`. zone-v5: `causalBlocked80`,
  `sessionAnchoredFrames`, `globexDailyRoll`. rsi-reversion:
  `requireContiguous`. That split is what lets the golden parity oracle stay
  green while live behaviour moves — never change a default to fix a bug.
- All three live streams are REFUTED and the evidence is in
  `docs/research/2026-07-31-phase1-findings.md`, RE-MEASURED on the corrected
  engine in `docs/research/2026-08-17-remeasurement.md`: 0 of 17 symbol-years beat
  matched random entries, on either engine. Two claims from the first run are
  WITHDRAWN by the second and should not be repeated: tier A is NOT
  anti-predictive (percentile 0.0 → 37.2 once impossible fills are removed — 63%
  of its 1,180 trades could not have been taken), and MNQ is NOT break-even gross
  (+$214 → −$19,286 once gapped stops stop filling at a price that never traded,
  so the entries lose before costs too). Do not tune them — the brief
  in that document forbids optimising a signal that does not beat a coin flip, and
  the losing baseline in `research_baselines` is the control for everything after.
  New ideas go through `/diagnostics` and the promotion gate
  (`lib/validation/promotionGate.ts`), never straight to a tier.
- Visual work follows `docs/design-language.md` — derived from the code, not
  invented. Two rules there are honesty rules, not style: insufficient evidence
  renders AMBER (never red — too little data is not a loss), and no rate renders
  without its `n`.
- Golden parity tests (`tests/*-parity.test.ts`) pin zone-v5 to a legacy oracle:
  behavior changes must be gated behind new params whose defaults preserve legacy
  behavior. Run `npm test` before every push.
- Supabase project "Trading Bot Aegis" (`bizgcoljagsnytrnaicr`) holds signals/zones/
  trades/engine_runs; the publishable key is committed in `lib/supabase/config.ts`
  by design and is now READ-ONLY on every table. (The journal-scoped INSERT/DELETE
  on `trades` was revoked by `20260727183355_private_journal_and_learning_audit.sql`,
  which moved the journal to owner-scoped `journal_entries`.) Engine writes need
  the service-role key (GitHub secret). Schema/policy changes are SQL files under
  `supabase/migrations/` — applied manually or via MCP, never assumed applied just
  because they are committed. The reverse used to happen too: a full column-level
  diff of the live project against every committed migration found 18 columns and
  3 indexes that existed only in production. `20260807030500_catch_up_drifted_schema.sql`
  closes that gap — it is `if not exists` throughout and a no-op against the live
  database, so its whole purpose is that a rebuild from this folder produces a
  database the engine can write to. Two of the three indexes were the `dedupe_key`
  unique constraints, i.e. the arbiters for the engine's `on conflict` upserts; a
  rebuild without them fails on every write with 42P10, not just on the first.
  Re-run that diff before trusting this folder again — drift is the default here,
  not the exception.
- Research tables (`research_baselines`, `research_trials`, `signal_excursion`) are
  guarded by TRIGGERS, not policies, and the distinction is deliberate: the engine
  writes with the service-role key, which bypasses RLS. A policy saying "nobody may
  edit this" would be no protection against the only writer that exists. Baselines
  are append-only; a trial's hypothesis/prediction/decision_rule and its recorded
  outcome are write-once.
- Public production URL: https://aegis-futures-lab-khaki.vercel.app (Vercel
  auto-deploys main).
- The parent "AI trading" folder outside this repo is a stale mirror — never edit it.
