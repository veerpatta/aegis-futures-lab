# Aegis Futures Lab — instructions for Codex

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

- Routes (plain-language mobile redesign, 2026-10-03): five phone tabs — Today `/`
  (`components/today/TodayClient.tsx`), Ideas `/signals` (`components/signals/IdeasClient.tsx`),
  Chart `/markets`, Bot `/brain` (`components/bot/BotClient.tsx`), More `/more`. URLs kept
  their old paths on purpose. `components/nav/links.tsx` holds `NAV_LINKS` and `MORE_GROUPS`
  (Your tools: Journal `/replay`, Review · Learn: Guide · Research room: Lab, Diagnostics, Data);
  `SECONDARY_LINKS` is the flattened groups. Compare, the legacy dashboard (`/research-history`)
  and `/brain/history` were removed; `next.config.ts` redirects them.
- Plain-language layer: every jargon word on screen goes through `<Term k=…>`
  (`components/ui/Glossary.tsx`) backed by `lib/glossary.ts`, which also renders the Guide's
  word list and must match `docs/USER-MANUAL.md` word for word (tests/plain-language pins it).
  Research numbers sit behind `components/ui/ShowNumbers.tsx`. Idea cards
  (`components/signals/IdeaCard.tsx`) always carry their method's standing badge
  (`lib/plain/idea.ts`). Sentences and verdicts live in `lib/plain/`.
- RESEARCH CODE HASH: `scripts/engine/research-code.ts` hashes `lib/strategies`, `lib/backtest`,
  `lib/costs`, `lib/indicators`, `lib/time`, `lib/market`, `lib/validation`,
  `lib/paper/policy.ts`, `lib/types.ts`, `regime.ts`, `research-observer.ts`,
  `paper-broker.ts`. Editing any of them restarts forward evidence and pauses releases.
  `tests/research-code-pin.test.ts` pins the hash — UI copy goes in `lib/plain/`, never in a
  hashed folder, and a deliberate research-code revision updates the pin in its own commit.
- Stale open rows: `run-live.ts` reconciles `triggered`/`pending` rows older than the 7-day
  mirror window (`lib/engine/stale-open.ts`), and the screens never show a row past its
  session's flatten time as OPEN (`lib/signals/open-state.ts`). Best-effort engine parts
  write `component_failed[<part>]` into the heartbeat (`lib/engine/markers.ts`); the
  watchdog's `watchdog-components` check alerts when one fails twice in a row.
- Weekly self-research: `.github/workflows/weekly-benchmark.yml` runs
  `scripts/diag/auto-benchmark.ts`, which measures ONE unmeasured method per run against
  matched random entries (preregistered `research_trials` row, append-only
  `research_baselines` row, issue + Telegram, Bot activity). Decision rule:
  `lib/research/auto-benchmark.ts`. It never promotes and never edits standing — a person
  moves a method in `lib/strategies/research-standing.json` (unhashed, so moving one does
  not restart forward evidence). Each method is measured once per research-code hash.
- Never run `scripts/engine/run-live.ts` locally: `.env.local` points at production Neon and
  there is no dry-run mode.
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
- A FOURTH thing is refuted, and it is a candidate rather than a stream:
  gold-silver-zone, measured 2026-08-21 in
  `docs/research/2026-08-21-gold-benchmark.md`. 0 of 9 symbol-years beat
  matched random entries; the full sample sits at the 53.8th percentile on
  1,782 trades. It is NOT anti-predictive (no cell below the 5th) and NOT a
  costs story (gross −$15,056), and the rho 0.735 correlation premise still
  holds — what fails is the inference built on it. It was measured WITHOUT
  being promoted, by `scripts/diag/gold-benchmark.ts`, because a candidate
  that must reach a tier before it can be benchmarked makes the gate
  unfalsifiable. Same rule as the other three: do not tune it.
- Strategy standing is a THREE-state fact in `lib/strategies/registry.ts`:
  `standingOf(id)` returns measured | unmeasured | refuted, and the Lab, the
  idea-card badges (`lib/plain/idea.ts`) and the Ideas verdict all read it. UNMEASURED is amber and REFUTED is red on
  purpose — "nobody has looked" and "we looked, and it is a coin flip" are
  different claims. Before this landed, `isHypothesis` was called
  "load-bearing for the UI" while only tests ever read it.
- A strategy DECLARES the feeds it runs on (`Strategy.feeds`, absent meaning
  the legacy `["MES","MNQ"]`); the UI asks rather than hardcoding the pair.
  `tradableFeedsFor()` derives `ExecutionConfig.tradableSymbols` from
  `ContractSpec.tradable`, so the engine guard cannot disagree with the table
  that role-locks silver to confirmation.
- Visual work follows `docs/design-language.md` — derived from the code, not
  invented. Two rules there are honesty rules, not style: insufficient evidence
  renders AMBER (never red — too little data is not a loss), and no rate renders
  without its `n`.
- Golden parity tests (`tests/*-parity.test.ts`) pin zone-v5 to a legacy oracle:
  behavior changes must be gated behind new params whose defaults preserve legacy
  behavior. Run `npm test` before every push.
- Neon project `floral-cell-79900814` is the active Aegis backend. Its schema,
  indexes, triggers and Data API policies are in `db/neon-schema.sql`. The browser
  reads public data through Neon Data API and uses Neon Auth for owner-scoped
  `journal_entries`; the engine uses a pooled PostgreSQL URL in the GitHub secret
  `NEON_DATABASE_URL`. Keep the URL server-side. The old Supabase project
  `bizgcoljagsnytrnaicr` is a paused migration source. Its historical migrations
  remain under `supabase/migrations/`; do not apply them to Neon. Check the live
  Neon schema against `db/neon-schema.sql` before trusting a rebuild.
- Research tables (`research_baselines`, `research_trials`, `signal_excursion`) are
  guarded by TRIGGERS, not policies, and the distinction is deliberate: the engine
  writes over a privileged database connection, which bypasses RLS. A policy saying "nobody may
  edit this" would be no protection against the only writer that exists. Baselines
  are append-only; a trial's hypothesis/prediction/decision_rule and its recorded
  outcome are write-once.
- Public production URL: https://aegis-futures-lab-khaki.vercel.app (Vercel
  auto-deploys main).
- The parent "AI trading" folder outside this repo is a stale mirror — never edit it.
