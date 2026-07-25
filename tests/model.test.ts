import { describe, expect, it } from "vitest";
import { nextModelStatus, selectVetoes, type EvalSnapshot } from "../scripts/engine/model";
import { GRADUATE_MIN_TRAIN, graduationProgress } from "../scripts/engine/winprob";

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

/* Finding 11: model lifecycle must not demote permanently on one bad/missing
   night. */
describe("nextModelStatus", () => {
  const active: EvalSnapshot = { status: "active", oos_brier: 0.2, baseline_brier: 0.3 };
  const activeRegressed: EvalSnapshot = { status: "active", oos_brier: 0.35, baseline_brier: 0.3 };
  const demoted: EvalSnapshot = { status: "demoted", oos_brier: 0.35, baseline_brier: 0.3 };
  const demotedBeat: EvalSnapshot = { status: "demoted", oos_brier: 0.2, baseline_brier: 0.3 };
  const m = (oos: number | null, base: number | null, train = 500) => ({ train_n: train, oos_brier: oos, baseline_brier: base });

  it("keeps status and skips when metrics are null (transient/insufficient)", () => {
    const d = nextModelStatus(active, m(null, 0.3), false);
    expect(d.status).toBe("active");
    expect(d.flip).toBeNull();
    expect(d.skipped).toBe(true);
  });

  it("does NOT demote an active model on a SINGLE regression", () => {
    const d = nextModelStatus(active, m(0.35, 0.3), false); // prev beat, now regressed
    expect(d.status).toBe("active");
    expect(d.flip).toBeNull();
  });

  it("demotes only on a SECOND consecutive measured regression", () => {
    const d = nextModelStatus(activeRegressed, m(0.36, 0.3), false); // prev regressed too
    expect(d.status).toBe("demoted");
    expect(d.flip?.action).toBe("veto_disabled");
  });

  it("a null night between regressions breaks the demotion streak", () => {
    // prev row was a skip (null metrics) ⇒ prevRegressed false ⇒ no demote.
    const prevSkip: EvalSnapshot = { status: "active", oos_brier: null, baseline_brier: null };
    expect(nextModelStatus(prevSkip, m(0.36, 0.3), false).status).toBe("active");
  });

  it("re-observes a demoted model after two consecutive baseline beats (not straight to active)", () => {
    const d = nextModelStatus(demotedBeat, m(0.2, 0.3), false); // prev beat + now beat
    expect(d.status).toBe("observe");
    expect(d.flip?.action).toBe("observe");
  });

  it("keeps a demoted model demoted on a single beat", () => {
    expect(nextModelStatus(demoted, m(0.2, 0.3), false).status).toBe("demoted");
  });

  /* Item 2.9: the graduation bar is 150 samples (down from 300, which sat ~14
     months out at ~0.7 signals/day) AND the out-of-sample win must repeat on
     two consecutive evaluations. Sample size traded for evidence stability. */
  describe("graduation (item 2.9)", () => {
    const observeBeat: EvalSnapshot = { status: "observe", oos_brier: 0.24, baseline_brier: 0.31 };
    const observeFresh: EvalSnapshot = { status: "observe", oos_brier: null, baseline_brier: null };
    const observeRegressed: EvalSnapshot = { status: "observe", oos_brier: 0.35, baseline_brier: 0.3 };

    it("graduates at the 150 bar when the baseline beat repeats", () => {
      const d = nextModelStatus(observeBeat, m(0.2, 0.3, GRADUATE_MIN_TRAIN), false);
      expect(d.status).toBe("active");
      expect(d.flip?.action).toBe("veto_enabled");
      expect(d.flip?.reason).toContain("2nd straight evaluation");
    });

    it("does NOT graduate on a single beat, however good", () => {
      // Previous night had no measurable OOS — one lucky fold is not evidence.
      expect(nextModelStatus(observeFresh, m(0.01, 0.5, 5000), false).status).toBe("observe");
      // Previous night regressed — the streak is broken.
      expect(nextModelStatus(observeRegressed, m(0.2, 0.3, 5000), false).status).toBe("observe");
    });

    it("still refuses below the sample bar and while frozen", () => {
      expect(nextModelStatus(observeBeat, m(0.2, 0.3, GRADUATE_MIN_TRAIN - 1), false).status).toBe("observe");
      expect(nextModelStatus(observeBeat, m(0.2, 0.3, GRADUATE_MIN_TRAIN), true).status).toBe("observe");
    });

    it("the bar is reachable: 150, not 300", () => {
      expect(GRADUATE_MIN_TRAIN).toBe(150);
    });
  });
});

describe("graduationProgress", () => {
  it("prints current vs required so the gate is never invisible", () => {
    expect(graduationProgress(93)).toBe(`93 of ${GRADUATE_MIN_TRAIN} needed`);
    expect(graduationProgress(null)).toBe(`0 of ${GRADUATE_MIN_TRAIN} needed`);
    expect(graduationProgress(undefined)).toBe(`0 of ${GRADUATE_MIN_TRAIN} needed`);
  });
});
