# OpenAI research assistant and paper shadow study — draft design

## Purpose

Help Aegis investigate whether new ideas can improve paper-trading results. The first release adds an evidence-grounded research assistant and a separate prospective shadow study. It is virtual only; it does not connect to a broker or promise profitable results. The current learner, its account, registered rules, risk limits, strategy parameters, promotion gate and historical records remain unchanged.

## Approach

Three approaches were considered: an assistant that only explains research; an assistant plus a separate shadow study; or allowing an AI model to decide trades in the existing paper account. The user selected the assistant plus shadow study. This gives ideas an independent prospective test without changing the existing account.

Use OpenAI's Responses API from a server-side component, with `OPENAI_API_SECRET` from Vercel's production environment. Begin with GPT-6.1 Sol for the fixed shadow study; use GPT-6 Astra only for explicitly requested deeper research when the available budget permits. A stronger general model is not evidence of a trading edge. Check model access and current prices before enabling either. Record the exact model, prompt version, request time and input snapshot for every evaluation; changing the model, prompt or feature definition starts a new study and fresh observation period.

## Research assistant

- Add an authenticated research area on Learn for questions about the bot's recorded status, studies, pauses and results, plus a way to request falsifiable hypotheses for new methods.
- Provide the model only a bounded, time-stamped snapshot of selected existing research and source activity. Link each claim to supplied evidence IDs; validate references before displaying them. If the evidence is missing, stale or insufficient, say so.
- Do not automatically send private journal entries, raw purchased historical bars, credentials or arbitrary database contents to OpenAI. Tell users that their question is sent to OpenAI and not to paste secrets or private journal data. Verify data-use rights before expanding inputs. A valid reference identifies supplied evidence; it does not prove the model's claim. Model output is untrusted text: it cannot run code, alter policies, submit orders, change strategy parameters or promote a method.
- Secure paid endpoints with server-verified Neon authentication. The user chose access for anyone who signs in, so reject anonymous sessions and apply per-account limits as well as the shared global cap. Keep each user's questions and answers private to that account; study summaries may be shared among signed-in users. The OpenAI owner ID is not a Neon account ID. Tell users that other signed-in accounts share the allowance.

## Separate paper shadow study

- Register a new study before collecting fresh results, including the model/prompt versions, input fields, eligibility rules, costs, matched controls and decision rule. Keep its append-only evidence separate from `experiment_*`, existing research standings and the account ledger.
- The existing learner publication excludes withheld ideas, and the signals table is a mutable replay. Capture a separate append-only source snapshot at the first actual receipt, including withheld ideas, with pause reason, source timestamps and data freshness. Exclude exit, outcome and P&L fields from the model input. Capture is best effort and cannot block the main engine or learner publication.
- Score only prospectively using information available at receipt. Record actual model response time and simulate no earlier than a subsequent eligible price bar. Ideas already closed, too late, revised away, missing or stale are skipped or quarantined with their reason; never reconstruct them as fresh. In this study, prospective means relative to receipt of delayed data, not a real-time market claim.
- Record the model's take/skip or abstain decision, raw and validated response, errors and bounded rationale, then follow the same eligible idea through a virtual outcome. Record unresolved cases instead of inventing fills. Shadow results do not change the account balance or bypass a source pause.
- Compare the frozen model, take-all, matched random choices and no trade on the same preregistered eligible opportunities, using realistic costs and slippage. Exclude truly unscored observations consistently from every comparison and report abstentions and coverage. Report sample counts, time periods and uncertainty, and keep historical development evidence apart from genuinely new forward observations. A result stays inconclusive until the study's registered evidence requirements are met. Model recommendations never activate themselves.
- Integrate collection through a separately authenticated, best-effort scheduler calling the Vercel-side service; Vercel secrets are not available to GitHub Actions or the Neon Function automatically. Missing inputs, invalid responses, stale data, failed auth, exhausted budget or an ambiguous provider response must stop that observation safely without affecting the existing engine or its publication.

## Budget, security and operations

- The user selected an Aegis target of up to $25 per month. Enforce it with an independently tracked monthly ledger in a private database, using atomic worst-case reservations before each request and reconciling actual token usage afterward. Leave ambiguous requests reserved until reconciled; fail closed if usage or pricing is unknown. Apply per-request input/output limits and per-account rate limits. Show signed-in users the reset timezone, current estimated spend, remaining shared allowance and paused/error state.
- The application cap covers Aegis requests tracked by this ledger; it cannot guarantee the total charge for other applications using the same OpenAI project, nor override provider billing behavior. Configure provider-side limits when available and verify them separately.
- Use the existing Vercel secret only server-side. Provision any additional scheduler authentication and least-privilege database connection through the appropriate services without logging secrets. Keep new study records and budget data private; expose only authorized summaries.
- Keep the current free-only learner function isolated from paid API dependencies. Update the Guide, Markdown manual and PDF to describe paid AI use, its separate budget, evidence limitations and virtual-only behavior.

## Acceptance and verification

- A signed-in user can ask a question and receive a response grounded in a saved snapshot; anonymous users cannot invoke paid features, and invalid citations and provider errors are shown as unknown, not facts.
- Unauthorized users, concurrent requests, retries and timeouts cannot bypass the app's budget reservation. An exhausted or unavailable ledger prevents new paid requests without interrupting the existing bot.
- A prospective shadow idea records its input, model, decision and later simulated result once. Paused, stale, late, revised and missing data are handled explicitly. No historical result becomes fresh evidence and no shadow record changes the learner or strategy standing.
- Recorded controls, modeled costs, sample sizes and data periods are visible. Replay and synthetic cases cannot demonstrate forward performance. Existing tests, a production build and browser/API tests pass; test provider calls use mocks unless an explicitly budgeted smoke test is selected.
