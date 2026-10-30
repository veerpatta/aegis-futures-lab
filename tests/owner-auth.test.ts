import { describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/ai-auth/owner";

describe("owner authorization", () => {
  it("rejects anonymous identity before querying private data", async () => {
    const query = vi.fn();
    expect(await requireOwner({ ok: false, status: 401, error: "sign in" }, query)).toMatchObject({ ok: false, status: 401 });
    expect(query).not.toHaveBeenCalled();
  });
  it("rechecks the signed subject and fails closed on revocation or database failure", async () => {
    const identity = { ok: true as const, userId: "owner" };
    expect(await requireOwner(identity, async () => true)).toEqual(identity);
    expect(await requireOwner(identity, async () => false)).toMatchObject({ ok: false, status: 401 });
    expect(await requireOwner(identity, async () => { throw Error("database secret"); })).toEqual({ ok: false, status: 503, error: "Owner verification is temporarily unavailable." });
  });
});
