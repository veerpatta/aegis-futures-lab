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
  `.github/workflows/signal-engine.yml`, Node 22 required). `EXECUTION` is now
  DERIVED from `LEGACY_MODEL` in `lib/costs/` rather than hardcoded — it still
  resolves to `{cost: 2.4, slippage: 0.25}`, and `tests/costs.test.ts` pins both
  the derivation and the literal every published figure was measured with.
- All three live streams are REFUTED and the evidence is in
  `docs/research/2026-07-31-phase1-findings.md`: 0 of 17 symbol-years beat matched
  random entries, tier A sits at the 0.0th percentile. Do not tune them — the brief
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
  because they are committed. The reverse also happens: `signals.dedupe_key`, `.qty`
  and `.score` are read and written by committed code but have NO committed
  migration, so this folder is not a complete picture of the live schema.
- Research tables (`research_baselines`, `research_trials`, `signal_excursion`) are
  guarded by TRIGGERS, not policies, and the distinction is deliberate: the engine
  writes with the service-role key, which bypasses RLS. A policy saying "nobody may
  edit this" would be no protection against the only writer that exists. Baselines
  are append-only; a trial's hypothesis/prediction/decision_rule and its recorded
  outcome are write-once.
- Public production URL: https://aegis-futures-lab-khaki.vercel.app (Vercel
  auto-deploys main).
- The parent "AI trading" folder outside this repo is a stale mirror — never edit it.
