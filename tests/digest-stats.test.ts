import { describe, expect, it } from "vitest";
import { activeOnly, exDoubtful, pausedPractice, stats, type HeadlineSig } from "../scripts/engine/digest-stats";

/* Finding 4: the weekly digest headline must exclude breaker-suppressed rows
   (consistent with Home/Signals) and report their practice separately. */

const sig = (pnl: number | null, suppressed = false, fc = "clean"): HeadlineSig => ({
  pnl_usd: pnl,
  fill_confidence: fc,
  suppressed,
});

describe("digest headline stats", () => {
  const rows = [sig(100), sig(-40), sig(200, true), sig(-500, true), sig(null)];

  it("activeOnly drops suppressed rows", () => {
    expect(activeOnly(rows).length).toBe(3); // two active closed + one open
  });

  it("headline stats compute over active rows only", () => {
    const s = stats(activeOnly(rows));
    expect(s.total).toBe(3);
    expect(s.closed).toBe(2);
    expect(s.net).toBe(60); // 100 - 40 — the suppressed -500/+200 excluded
  });

  it("suppressed rows never leak into the headline net", () => {
    const withSuppressed = stats(rows).net; // 100-40+200-500
    const headline = stats(activeOnly(rows)).net; // 100-40
    expect(withSuppressed).toBe(-240);
    expect(headline).toBe(60);
    expect(headline).not.toBe(withSuppressed);
  });

  it("pausedPractice reports the benched streams separately", () => {
    const p = pausedPractice(rows);
    expect(p.total).toBe(2);
    expect(p.closed).toBe(2);
    expect(p.net).toBe(-300); // 200 - 500
  });

  it("exDoubtful still works and composes with activeOnly", () => {
    const r = [sig(100), sig(300, false, "doubtful"), sig(50, true)];
    expect(stats(exDoubtful(activeOnly(r))).net).toBe(100); // drops doubtful + suppressed
  });
});
