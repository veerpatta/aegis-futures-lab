# OpenAI research assistant implementation plan

**Goal:** Add an authenticated, evidence-grounded assistant and a separately registered prospective paper study with a $25 monthly Aegis cap.

**Architecture:** The Vercel-side service verifies Neon identities, reserves spend atomically in a private PostgreSQL ledger, reads bounded public evidence, calls the OpenAI Responses API, validates citations and persists private user results. A best-effort source snapshot and independently authenticated scheduler feed an isolated shadow study; neither can alter the existing experiment or block the signal engine.

**Spec:** docs/superpowers/specs/2026-10-30-openai-research-design.md

## Constraints and review focus

- Never send credentials, private journal records or raw purchased bars to the provider. User questions are sent to OpenAI with an explicit warning.
- Reject anonymous identities and fail closed when auth, price, ledger or storage is unavailable; atomically reserve worst-case spend before any provider request; retain ambiguous reservations.
- Freeze study model, prompt, inputs and registered rules; capture actual receipt and response timestamps, exclude outcome leakage, never classify delayed replay as fresh.
- Do not modify the active learner, the research code hash, historical evidence, existing risk policy, or promotion gates.
- Apply database migrations only after live schema/permissions inspection; use best-effort source capture and an independently authenticated scheduled processor.

## Work packages

1. Verify Neon bearer authentication; implement bounded per-user and monthly request accounting with concurrent and timeout tests.
2. Create private database schema, immutable study and evidence records; integrate source snapshots and the separate prospective shadow scheduler and controls.
3. Implement the server-side OpenAI research endpoint: bounded snapshots, strict citation validation, request privacy, error handling and no unbudgeted provider call.
4. Add the signed-in research and shadow UI; update the in-app guide, Markdown manual and PDF.
5. Exercise auth, request accounting, isolation, stale/revised/late data, shadow outcomes and controls; run the full suite, production build and browser tests; review changes before any deployment.
