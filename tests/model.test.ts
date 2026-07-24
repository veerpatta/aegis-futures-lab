import { describe, expect, it } from "vitest";
import { selectVetoes } from "../scripts/engine/model";

/* Finding 7: the veto flags at most ceil(0.1 * n) of the scored rows — the
   strictly lowest at/below the trailing-decile threshold — and fails OPEN when
   boundary ties would overflow the cap (a non-discriminating model vetoes
   nothing rather than everything). */

const row = (win_prob: number | null) => ({ win_prob });

describe("selectVetoes", () => {
  it("vetoes at most ceil(0.1 * n), the lowest below threshold", () => {
    // 20 rows 0.01..0.20; threshold 0.10 ⇒ 10 eligible, cap ceil(2)=2.
    const rows = Array.from({ length: 20 }, (_, i) => row((i + 1) / 100));
    const vetoed = selectVetoes(rows, 0.1);
    expect(vetoed.length).toBe(2);
    expect(vetoed.map((r) => r.win_prob)).toEqual([0.01, 0.02]);
  });

  it("fails OPEN: a degenerate all-equal model vetoes nothing", () => {
    const rows = Array.from({ length: 30 }, () => row(0.5)); // every prediction 0.5
    // threshold from an all-0.5 distribution is 0.5; every row ties at the boundary.
    expect(selectVetoes(rows, 0.5).length).toBe(0);
  });

  it("drops boundary ties that would overflow the cap", () => {
    // cap = ceil(0.1*20) = 2, but three rows tie at the boundary 0.05.
    const rows = [row(0.01), row(0.05), row(0.05), row(0.05), ...Array.from({ length: 16 }, (_, i) => row(0.2 + i / 100))];
    const vetoed = selectVetoes(rows, 0.05);
    // eligible = {0.01, 0.05, 0.05, 0.05} (4) > cap 2 ⇒ boundary 0.05, keep strictly-below.
    expect(vetoed.map((r) => r.win_prob)).toEqual([0.01]);
  });

  it("vetoes nothing when nothing is below threshold or threshold is null", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(0.5 + i / 100));
    expect(selectVetoes(rows, 0.1).length).toBe(0); // all above threshold
    expect(selectVetoes(rows, null).length).toBe(0);
  });
});
