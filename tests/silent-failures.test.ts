import { describe, expect, it } from "vitest";
// digest-stats, not digest: digest.ts runs main() on import.
import { capIssueBody, GITHUB_ISSUE_BODY_MAX } from "../scripts/engine/digest-stats";
import { lastCompletedTradingDay } from "../scripts/engine/context";

/* Three places where a failure used to be recorded as a success, or where a
   guard could never latch. Each test names the observable symptom, because in
   every case the run stayed green and the log looked fine. */

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("digest issue body cap", () => {
  it("leaves a normal digest untouched", () => {
    const md = "# Weekly digest\n\nnothing unusual.";
    expect(capIssueBody(md)).toBe(md);
  });

  it("trims an over-long body instead of letting GitHub 422 the whole digest", () => {
    // The realistic trigger: a bad week errors on every 15-minute pass and the
    // inline error list runs away. A 422 used to return a validation object,
    // the digest logged "#undefined", and last week's issue was still closed
    // with "Superseded by #undefined" — green run, no digest, prior one gone.
    const md = "x".repeat(GITHUB_ISSUE_BODY_MAX + 5_000);
    const out = capIssueBody(md);
    expect(out.length).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_MAX);
    expect(out).toContain("Truncated");
    expect(out).toContain(String(md.length));
  });

  it("respects an explicit smaller limit", () => {
    const out = capIssueBody("y".repeat(500), 200);
    expect(out.length).toBeLessThanOrEqual(200);
  });
});

describe("lastCompletedTradingDay", () => {
  /* The context sweep's guard used to ask for TODAY's row. ^VIX publishes a
     daily close, so that row cannot exist before the close — the guard never
     latched during the morning and every engine pass re-fetched three symbols
     over three months. Confirmed live: both Saturday 2026-07-25 runs re-swept
     while the newest stored row was 2026-07-24. */

  it("is yesterday's session before the cash close", () => {
    // Fri 2026-07-24 10:00 ET — today's daily bar is not final yet.
    expect(lastCompletedTradingDay(sec("2026-07-24T14:00:00Z"))).toBe("2026-07-23");
  });

  it("is today once the cash close has passed", () => {
    // Fri 2026-07-24 17:00 ET.
    expect(lastCompletedTradingDay(sec("2026-07-24T21:00:00Z"))).toBe("2026-07-24");
  });

  it("walks back over the weekend", () => {
    // Sat 2026-07-25 03:56 ET and Sun 2026-07-26 12:00 ET both point at Friday.
    expect(lastCompletedTradingDay(sec("2026-07-25T07:56:00Z"))).toBe("2026-07-24");
    expect(lastCompletedTradingDay(sec("2026-07-26T16:00:00Z"))).toBe("2026-07-24");
    // Mon 2026-07-27 01:37 UTC = Sun 21:37 ET — still Friday.
    expect(lastCompletedTradingDay(sec("2026-07-27T01:37:00Z"))).toBe("2026-07-24");
  });

  it("means the Saturday runs would have skipped the sweep", () => {
    // The newest row in context_daily at that moment.
    const newest = "2026-07-24";
    expect(newest >= lastCompletedTradingDay(sec("2026-07-25T07:50:30Z"))).toBe(true);
    expect(newest >= lastCompletedTradingDay(sec("2026-07-25T07:55:17Z"))).toBe(true);
  });
});
