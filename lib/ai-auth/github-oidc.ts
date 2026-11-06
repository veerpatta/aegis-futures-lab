/* Who may start the AI helper: only this repository's signal-engine workflow
   on main, proven by a GitHub Actions OIDC token.

   This needs no shared secret. The workflow job asks GitHub for a short-lived
   token with our audience; GitHub signs it, and we check the signature against
   GitHub's published keys plus the claims that pin the repository, the
   branch and the workflow file. A token minted for a fork, a pull request, a
   different branch or another workflow fails. */

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const AI_HELPER_AUDIENCE = "aegis-ai-helper";
export const AI_HELPER_REPOSITORY = "veerpatta/aegis-futures-lab";
export const AI_HELPER_REF = "refs/heads/main";
export const AI_HELPER_WORKFLOW_REF = `${AI_HELPER_REPOSITORY}/.github/workflows/signal-engine.yml@${AI_HELPER_REF}`;
const EVENTS = new Set(["schedule", "workflow_dispatch"]);

export type OidcResult = { ok: true; runId: string | null; event: string } | { ok: false; status: 401 | 503; error: string };
const denied: OidcResult = { ok: false, status: 401, error: "Unauthorized" };

export function createGithubOidcVerifier(jwks: JWTVerifyGetKey) {
  return async (request: Request): Promise<OidcResult> => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (!match || match[1].length > 8192) return denied;
    try {
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer: GITHUB_OIDC_ISSUER,
        audience: AI_HELPER_AUDIENCE,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "repository", "ref", "workflow_ref", "event_name"],
        maxTokenAge: "15m",
      });
      if (payload.repository !== AI_HELPER_REPOSITORY || payload.ref !== AI_HELPER_REF ||
          payload.workflow_ref !== AI_HELPER_WORKFLOW_REF || typeof payload.event_name !== "string" || !EVENTS.has(payload.event_name))
        return denied;
      const runId = typeof payload.run_id === "string" && /^\d{1,20}$/.test(payload.run_id) ? payload.run_id : null;
      return { ok: true, runId, event: payload.event_name };
    } catch (err) {
      if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError))
        return { ok: false, status: 503, error: "Verification is temporarily unavailable." };
      return denied;
    }
  };
}

const githubKeys = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`), { timeoutDuration: 5000 });
export const verifyGithubOidc = createGithubOidcVerifier(githubKeys);
