# Aegis controls recovery evidence — 2026-10-30

The adjacent file is a **redacted schema comparison**, not a migration and not the original prepared SQL. It compares the Neon test branch `mcp-migration-2026-10-30T11-45-10` with its production parent at the branch point (2026-10-30 11:45:07 UTC). Raj's account identifier is replaced with `REDACTED_OWNER_ID`. The original application changes and migration preparation identifier were not found in this checkout, its Git history, or the remote branch at the time of recovery.

The comparison records a command queue, completion guard, and private-data policies. It cannot establish the original migration's ordering, transaction, safety checks, rollback, application logic, or tests. Do not apply it as SQL. In particular, a new implementation must verify authorization at enqueue and execution, concurrency with learner jobs, behavior of existing positions and locked campaigns, and private data access. Public pages should remain accessible. Update the guide and manual for user-visible controls.

Production was at Git commit `81a6b494957af563dfda03823dd80e316ad66750` when checked. No control migration or deployment was performed in this recovery. The previous report of 1,273 tests describes different, unavailable artifacts and is not validation of any replacement.

A separately reconstructed replacement was subsequently prepared on a new Neon test branch. See `2026-10-30-replacement-status.md` for its identity, tests and outstanding deployment gates.
