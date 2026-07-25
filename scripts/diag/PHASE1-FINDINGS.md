# Phase 1 — tier A drought: diagnosis

Reproduce with `npx tsx scripts/diag/tier-a.ts`. Read-only: no writes, no
strategy change, no commit to strategy logic. `npm test` → 26 files / 196 tests
passing (unchanged).

Data: `bars_5m` archive, MES + MNQ, 11,571 bars each, 2026-05-26 → 2026-07-24.

---

## Verdict: the hypothesis is refuted

The RTH/globex annotation mismatch is **real and is doing damage**, but not the
damage the hypothesis predicted, and `invalidFill` is not the bottleneck.

Three premises in the brief do not survive the data:

| premise | what the data says |
|---|---|
| tier A silent for **five weeks** | `engine_runs` starts **2026-07-19 11:31 UTC** — 118 runs, **6 calendar days / 5 trading days**. Signal rows reach back to 07-13 only because each run mirrors a trailing 7 days. |
| `invalidFill: 61` is the count that matters | 61 came from **one** `gate_costs` window. The next night's window gives **4**. Both replay bar-for-bar off the same archive (§5). |
| `notFresh: 0` corroborates a blind annotation | `notFresh` *is* emitted (`zone-v5/engine.ts:751`), so the zero is real — but `zoneFallback` preferring a fresh 1H zone explains it. Aligning the annotation basis pushes it to **295**. |

---

## 1. Tier A trades on one day in fifty

Run (a) — production config, trailing 60 days: **22 qualified, 14 trades, 50 sessions**.

All 14 are on **2026-07-09**: all MES, all SHORT, all score 100, entered between
02:00 and 09:30 ET, re-entering the same 1H supply zone bar after bar. Every
other one of the 50 sessions produced **zero**.

The engine's first run was 2026-07-19 11:31 UTC, so its earliest 7-day mirror
cutoff was 2026-07-12. **2026-07-09 was already outside the mirror window on the
first run and on all 118 runs since.** Nothing was dropped, mis-keyed or
swallowed — there is no plumbing bug in `run-live.ts`. Tier A wrote zero rows
because, over the window it has been alive for, it produced zero trades.

Tier A's frequency in this data is **one clustered day per fifty**, not 0.3–0.4
trades/day.

## 2. Twelve of the fourteen trades are on a zone that was already dead

The zone: MES 1H supply, formed 2026-07-08 10:00 ET.

| | RTH annotation | full series |
|---|---|---|
| first return | 09:30 ET | **00:50 ET** |
| broken | 09:35 ET | **03:40 ET** |

**12 of 14 trades entered a zone the full series had already broken** (one of
those on the breaking bar itself, where intra-bar order is unknowable from OHLC);
**14 of 14 entered a zone already returned to.** The RTH-only annotation sees
neither event, so `alive()` and `freshAt()` keep clearing the same zone for
re-entry all night.

The mismatch therefore does not *suppress* tier A signals — it **manufactures**
them, as clustered overnight re-entries on stale structure. That is why aligning
the bases lowers trade count instead of raising it.

## 3. The four `invalidFill`s do fit the mechanism — and are trivial

All 4 are that same zone, rejecting bars at 03:45, 03:50, 04:05, 04:10 ET.
**4 of 4 (100%) fall outside 09:30–16:00 ET**; annotated `brokenAt` 09:35 vs true
03:40. The hypothesised mechanism is confirmed *in kind* — and it accounts for 4
skips, not 61.

## 4. Aligning the bases kills tier A outright

| run | basis | qualified | invalidFill | trades | trades/day | PF | net | win% |
|---|---|---|---|---|---|---|---|---|
| (a) production | RTH annotation, 23h walk | 22 | 4 | 14 | 0.280 | 0.86 | −$192 | 35.7 |
| (b) `structure:"full"` | full detection + annotation, 23h walk | 6 | 0 | 6 | 0.120 | 0.50 | −$241 | 16.7 |
| (b2) isolating | RTH detection, annotation on full series | **0** | 0 | 0 | 0.000 | — | $0 | — |
| (c) RTH walk | RTH annotation, RTH walk | **0** | 0 | 0 | 0.000 | — | $0 | — |

Tuned expectation: 0.3–0.4 trades/day at PF ≈ 1.35.

Run (b2) is the discriminating one: same bars, same zone set as (a), **only the
annotation basis differs**. `notFresh` goes 7 → 295 and tier A goes silent — on
the full series those zones had their first return overnight and are correctly
no longer fresh. Run (c) additionally removes the 02:00–09:30 ET window that
`entryHours: "day"` was tuned to use, and also lands on zero.

**No basis reproduces the tuned band.** Production is at the bottom of it on
frequency (0.28/day) but at PF 0.86 — net **negative**. The 14 trades the drought
hid were not profit that was missed.

## 5. The finding that matters more: `gate_costs` slices the archive mid-session

`learned_stats.gate_costs` holds two nightly runs 13 hours apart. Both windows
still sit inside the archive, so both replay bar-for-bar. Same archive, same
code, same params:

| window | bars | noHtf | nesting | noTouch | weakZone | invalidFill | qualified | tier A trades |
|---|---|---|---|---|---|---|---|---|
| 07-23 payload (06-24 17:11 → 07-24 17:11 UTC) | 5,827 | 3,829 | 6,577 | 543 | 119 | **61** | 112 | **2** |
| 07-24 payload (06-25 06:19 → 07-25 06:19 UTC) | 5,728 | 6,390 | 3,654 | 718 | 0 | **4** | 69 | **14** |
| recorded in `learned_stats` | | 3,827 / 6,390 | 6,575 / 3,654 | 543 / 718 | 119 / 0 | 61 / 4 | 112 / 69 | |

Reproduced to within 2 counts on every gate. `nesting` and `noHtf` trade places
while their sum stays near-constant (10,406 vs 10,044) — the Daily/4H zone set
itself changed, so setups that reached the nesting gate in one run find no HTF
zone in the next.

### It is the start edge, and the mechanism is measured

The two windows differ at **both** edges. Crossing them attributes the swing:

| window | invalidFill | nesting | noHtf | weakZone | tier A trades |
|---|---|---|---|---|---|
| start 07-23 · end 07-23 | 61 | 6,577 | 3,829 | 119 | 2 |
| start 07-23 · end 07-24 | 61 | 6,622 | 3,855 | 119 | **2** |
| start 07-24 · end 07-23 | 4 | 3,622 | 6,364 | 0 | **14** |
| start 07-24 · end 07-24 | 4 | 3,654 | 6,390 | 0 | 14 |

**The start edge decides everything; the end edge is noise.** And the start edge
does it through a truncated first daily bar:

| window start | daily bars | bar 0 | bar 0's 5m bars | bar 0 range | mean range |
|---|---|---|---|---|---|
| 07-23 → 06-24 **13:11 ET** (mid-session) | 22 | 2026-06-24 | **27** of 72 | **43.75** | 67.93 |
| 07-24 → 06-25 **02:19 ET** (pre-open) | 21 | 2026-06-25 | 72 of 72 | 100.50 | 69.08 |

`candleMeta` (`zone-v5/engine.ts:219-251`) classifies every candle `base` /
`leg` / `strong` against a **14-bar rolling mean of range, seeded with bar 0's
own range** (`avg = window.length ? rollSum/window.length : range`, line 231).
The truncated 06-24 bar seeds that mean at 43.75 instead of ~100 — **2.3× too
small** — and keeps it depressed for the next 14 daily bars, i.e. two-thirds of a
21-bar frame. A depressed `avg` makes `strong` (≥0.7·avg) and `leg` (≥0.55·avg)
far easier and `base` (≤0.5·avg) far harder, so the Daily zone set is rebuilt
differently across the whole window. Zone detection is entirely downstream of
that classification.

### Which code paths are exposed

Checked directly: Yahoo's `range=60d` returns **day-aligned** data (first RTH day
= 72 of 72 bars), so `run-live.ts` → `fetchYahooBars` is **not** exposed. Exposed
are the paths that slice the archive at an arbitrary instant:

- `gate-costs.ts:71` — `nowSec - 30*86400`. **This is where the brief's numbers
  come from.** The 61 was produced by a manually-dispatched nightly-learn at
  17:11 UTC (13:11 ET, mid-session); the scheduled cron is `30 5 * * 2-6`
  (~01:30 ET, pre-open), which is why the next night's run reported 4.
- `run-live.ts:121` `archiveTrailingBars` — same instant slice, used as the
  Yahoo-down fallback, so live signals *are* exposed on fallback runs.
- `report.ts --archive`, i.e. the tuning numbers in the `tiers.ts` header.

So: `invalidFill: 61` never described the live signal path. It described a
poisoned Daily frame in a bookkeeping job.

---

## Ranked alternatives

1. **Truncated first daily bar poisons `candleMeta`'s normalizer** (§5).
   Mechanism measured, not inferred; edge-isolated; reproduces both payloads to
   within 2 counts. Corrupts every archive-sliced tier-A number, including the
   tuning baseline. Cheap to fix (day-align the archive slice), and it must land
   before any entry-side change, because it decides what the funnel even says.
2. **Genuine low frequency with severe clustering** (§1). Tier A fires on 1 of 50
   sessions. Even with a perfect stack it does not reach 0.3–0.4/day here.
3. **RTH/globex annotation mismatch** (§2, §3). Real, confirmed in kind, and a
   correctness defect worth fixing — but its effect is to manufacture stale-zone
   overnight re-entries (12 of 14 trades), so fixing it lowers trade count.
4. **`invalidFill` as a bottleneck.** Refuted — 4 in the current window.
5. **A plumbing bug in `run-live.ts`.** Refuted — the one trading day predates
   the mirror window on every run the engine has made.

## Recommendation

**Do not ship the fix the brief describes yet, in either direction.** Both land
below the tuned band — `structure:"full"` at 0.12/day and PF 0.50, and both
basis-aligned variants at zero — so "make the annotation basis and the walk basis
agree" replaces a drought with a guaranteed silence.

Sequence I'd propose instead:

1. Day-align the archive slice in `gate-costs.ts` (and `archiveTrailingBars`), so
   the funnel stops changing 80% between runs. Param-gated, defaults preserved,
   parity untouched. Re-measure everything after.
2. Re-run the tuning report on a day-aligned archive. The 0.3–0.4/day at PF 1.35
   baseline was produced by the affected path and should be treated as unverified
   until then.
3. Only then decide the annotation basis, with a funnel that means something.
   The honest options at that point are to accept tier A as a ~1-day-in-50
   stream, or to loosen an upstream gate (`htf1h`, `htfRange`) — both of which
   need the stable measurement first.

## Housekeeping

`scripts/diag/tier-a.ts` **kept** (not deleted): the window-sensitivity and
edge-isolation harness is reusable and is what any future funnel anomaly should
be checked against.
