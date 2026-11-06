import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { AI_HELPER_AUDIENCE, AI_HELPER_WORKFLOW_REF, createGithubOidcVerifier, GITHUB_OIDC_ISSUER } from "@/lib/ai-auth/github-oidc";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const verify = createGithubOidcVerifier(createLocalJWKSet({ keys: [jwk] }));
  const good: JWTPayload = {
    repository: "veerpatta/aegis-futures-lab", repository_id: "1304384083", repository_owner_id: "222136377", ref: "refs/heads/main", workflow_ref: AI_HELPER_WORKFLOW_REF, event_name: "workflow_dispatch", run_id: "123",
  };
  const sign = (claims: JWTPayload, opts: { iss?: string; aud?: string; key?: CryptoKey } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(opts.iss ?? GITHUB_OIDC_ISSUER)
      .setAudience(opts.aud ?? AI_HELPER_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(opts.key ?? privateKey);
  const req = (token: string) => new Request("https://aegis.test/api/ai/run", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return { verify, good, sign, req };
}

describe("GitHub OIDC gate for the AI helper", () => {
  it("accepts this repository's signal-engine workflow on main", async () => {
    const { verify, good, sign, req } = await setup();
    expect(await verify(req(await sign(good)))).toEqual({ ok: true, runId: "123", event: "workflow_dispatch" });
    expect((await verify(req(await sign({ ...good, event_name: "schedule" })))).ok).toBe(true);
  });

  it("refuses other repositories, branches, workflows and events", async () => {
    const { verify, good, sign, req } = await setup();
    for (const claims of [
      { ...good, repository: "someone/fork" },
      { ...good, ref: "refs/heads/feature" },
      { ...good, workflow_ref: "veerpatta/aegis-futures-lab/.github/workflows/ci.yml@refs/heads/main" },
      { ...good, workflow_ref: "veerpatta/aegis-futures-lab/.github/workflows/signal-engine.yml@refs/pull/7/merge" },
      { ...good, event_name: "pull_request" },
      // Same names, different repository or owner (e.g. deleted and re-created).
      { ...good, repository_id: "999" },
      { ...good, repository_owner_id: "999" },
      { ...good, repository_id: 1304384083 },
    ]) expect(await verify(req(await sign(claims)))).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a wrong audience, issuer or signing key, and a missing header", async () => {
    const { verify, good, sign, req } = await setup();
    expect((await verify(req(await sign(good, { aud: "someone-else" })))).ok).toBe(false);
    expect((await verify(req(await sign(good, { iss: "https://evil.example" })))).ok).toBe(false);
    const other = await generateKeyPair("RS256");
    expect((await verify(req(await sign(good, { key: other.privateKey })))).ok).toBe(false);
    expect(await verify(new Request("https://aegis.test/api/ai/run", { method: "POST" }))).toMatchObject({ ok: false, status: 401 });
  });
});
