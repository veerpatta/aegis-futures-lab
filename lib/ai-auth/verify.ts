/* Verify the signed Neon JWT before any paid work. Never decode a token and
 * trust its claims without signature, issuer, audience and expiry checks. */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { NEON_AUTH_URL } from "@/lib/neon/config";

export type AiIdentity = { ok: true; userId: string } | { ok: false; status: 401 | 503; error: string };
const denied: AiIdentity = { ok: false, status: 401, error: "Sign in to use research." };

export function createNeonVerifier(config: { issuer: string; audience: string; jwks: JWTVerifyGetKey }) {
  return async (request: Request): Promise<AiIdentity> => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match || match[1].length > 8192) return denied;
    try {
      const { payload } = await jwtVerify(match[1], config.jwks, {
        issuer: config.issuer, audience: config.audience, algorithms: ["EdDSA"], requiredClaims: ["sub", "exp", "iat"],
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 256 ||
          payload.role !== "authenticated" || payload.banned === true || payload.is_anonymous === true)
        return denied;
      return { ok: true, userId: payload.sub };
    } catch (err) {
      if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError))
        return { ok: false, status: 503, error: "Sign-in verification is temporarily unavailable." };
      return denied;
    }
  };
}

// Neon Managed Auth issues JWTs with the Auth URL's origin as issuer and
// audience; the JWKS path itself includes the database/auth path.
const base = new URL(NEON_AUTH_URL);
const jwks = createRemoteJWKSet(new URL(`${NEON_AUTH_URL.replace(/\/$/, "")}/.well-known/jwks.json`), { timeoutDuration: 5000 });
export const verifyNeonResearchUser = createNeonVerifier({ issuer: base.origin, audience: base.origin, jwks });
