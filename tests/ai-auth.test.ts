import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createNeonVerifier } from "@/lib/ai-auth/verify";

const issuer = "https://example.neonauth.test";
let sign: CryptoKey;
let verify: ReturnType<typeof createNeonVerifier>;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA");
  sign = pair.privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  verify = createNeonVerifier({ issuer, audience: issuer, jwks: createLocalJWKSet({ keys: [jwk] }) });
});
async function token(claims: Record<string, unknown> = {}, extra: { iss?: string; aud?: string; expiry?: string } = {}) {
  return new SignJWT({ role: "authenticated", emailVerified: true, banned: false, ...claims }).setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setIssuer(extra.iss ?? issuer).setAudience(extra.aud ?? issuer).setSubject("user-123").setIssuedAt().setExpirationTime(extra.expiry ?? "5m").sign(sign);
}
const request = (t?: string) => new Request("https://aegis.test/api/ai/research", { headers: t ? { Authorization: `Bearer ${t}` } : {} });

describe("paid API authentication", () => {
  it("accepts signed-in identities whether or not email verification is enabled", async () => {
    for (const claims of [{}, { emailVerified: false }, { emailVerified: undefined }])
      expect(await verify(request(await token(claims)))).toEqual({ ok: true, userId: "user-123" });
  });
  it("rejects anonymous and banned accounts", async () => {
    for (const claims of [{ role: "anonymous" }, { banned: true }, { is_anonymous: true }])
      expect((await verify(request(await token(claims)))).ok).toBe(false);
  });
  it("rejects missing, opaque, expired, and incorrectly scoped tokens", async () => {
    for (const t of [undefined, "opaque-session-token", await token({}, { expiry: "-1s" }), await token({}, { iss: "https://attacker.test" }), await token({}, { aud: "wrong" })])
      expect((await verify(request(t))).ok).toBe(false);
  });
  it("rejects forged signatures even when claims look valid", async () => {
    const other = await generateKeyPair("EdDSA");
    const forged = await new SignJWT({ role: "authenticated", emailVerified: true }).setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
      .setIssuer(issuer).setAudience(issuer).setSubject("user-123").setIssuedAt().setExpirationTime("5m").sign(other.privateKey);
    expect((await verify(request(forged))).ok).toBe(false);
  });
});
