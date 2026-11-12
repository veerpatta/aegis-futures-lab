# Project skills: the day-trader pack

Ten Claude Code skills from github.com/Jakeschincariol/day-trader-skill
(MIT, commit `3d0f4ef`, licence in `DAY-TRADER-SKILL-LICENSE`), installed
2026-11-12. Claude Code loads them automatically in this repo as
`/trader-scanner`, `/trader-news`, `/trader-entry`, `/trader-exit`,
`/trader-timemachine`, `/trader-budget`, `/trader-risk`, `/trader-alerts`,
`/trader-analyst` and `/trader-pelosi`.

They are helpers for Claude, not part of the app. Nothing here is read by the
engine, the learner, the website or the research-code hash. They write their
working files to `trader/` at the repo root, which git ignores.

## What was left out, and why

`trader-broker` (the order executor that connects Alpaca or Interactive
Brokers) is NOT installed. This project's standing rule is that nothing here
touches real money. Add it only on purpose.

## Fit with this project

- The time machine's method is also built into the app for MES/MNQ: open any bot
  trade and tap Time machine (`lib/timemachine/`, see CLAUDE.md). The app version
  uses the bot's own bars, its 02:00 to 15:25 ET window and its fill rules.
- The pack is built for US stocks (Yahoo Finance, Nasdaq symbol lists, SEC,
  House Clerk). The scanner, news, analyst and Pelosi skills are stock-only.
  The time machine, entry, exit, budget, risk and alerts skills take any Yahoo
  symbol, e.g. `MES=F`, but assume stock hours (9:30 to 4:00 ET) and share
  sizing, not contract point values.
- An opening-range breakout from these skills is a NEW, unmeasured idea. It
  does not go to a tier: it goes through `/diagnostics` and the promotion gate
  like every other idea (see CLAUDE.md). The time machine's odds are a
  simulation, not evidence.
- Yahoo rate-limits some cloud machines (HTTP 429). Run the data tools from
  your own computer if that happens.
- Python 3.8+, standard library only. The SEC tools need
  `SEC_USER_AGENT="Your Name you@example.com"`.
