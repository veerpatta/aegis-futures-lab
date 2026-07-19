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

Writing style for all three: plain trading language, no tech jargon, sentence case,
short sentences. The reader knows trading but not software. Always keep the
"nothing here touches real money / delayed data" warning prominent.

## Repo facts

- The engine's live tier configuration lives in `scripts/engine/tiers.ts`; the
  scheduled runner is `scripts/engine/run-live.ts` (GitHub Actions,
  `.github/workflows/signal-engine.yml`, Node 22 required).
- Golden parity tests (`tests/*-parity.test.ts`) pin zone-v5 to a legacy oracle:
  behavior changes must be gated behind new params whose defaults preserve legacy
  behavior. Run `npm test` before every push.
- Supabase project "Trading Bot Aegis" (`bizgcoljagsnytrnaicr`) holds signals/zones/
  trades/engine_runs; the publishable key is committed in `lib/supabase/config.ts`
  by design.
- Public production URL: https://aegis-futures-lab-khaki.vercel.app (Vercel
  auto-deploys main).
- The parent "AI trading" folder outside this repo is a stale mirror — never edit it.
