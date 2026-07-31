/* Which feed a bars_5m row came from.
   ─────────────────────────────────────────────────────────────────────────
   bars_5m now holds two histories over the same timestamps: the delayed Yahoo
   MES=F/MNQ=F series the live engine has always written, and the real CME
   contracts pulled once from Databento. The primary key is
   (symbol, source, time), so they coexist rather than overwrite.

   EVERY read must state which one it wants. A read that omits the filter
   silently returns BOTH feeds interleaved — two bars per timestamp, in
   arbitrary order — which produces a bar series that is not wrong in any way
   a finite/NaN check would catch, just quietly doubled and self-contradictory.
   tests/archive-window.test.ts enforces the filter structurally, the same way
   it already enforces alignArchiveSlice, because there is no type that can. */

export type BarSource = "yahoo" | "databento";

/* What the live engine writes and what every existing measurement was taken
   on. Readers default here so today's numbers keep reproducing; the Databento
   history is opt-in per call site rather than a silent upgrade. */
export const DEFAULT_BAR_SOURCE: BarSource = "yahoo";

export const BAR_SOURCES: readonly BarSource[] = ["yahoo", "databento"] as const;

/** Read a source from an env var or CLI flag, rejecting anything unknown.
    A typo must fail loudly rather than filter to a namespace with no rows,
    which would look exactly like "the archive is empty". */
export function parseBarSource(raw: string | undefined | null): BarSource {
  if (raw === undefined || raw === null || raw.trim() === "") return DEFAULT_BAR_SOURCE;
  const v = raw.trim().toLowerCase();
  if ((BAR_SOURCES as readonly string[]).includes(v)) return v as BarSource;
  throw new Error(
    `Unknown bar source "${raw}". Known: ${BAR_SOURCES.join(", ")}. ` +
      `An unrecognised source would filter to zero rows and read as an empty archive.`
  );
}
