/* Zero-cost mode for paid AI.

   The owner's standing instruction (2026-11-06): no costs from GitHub or
   anywhere; keep the project as close to free as possible. The only part of
   this app that can spend money is OpenAI (research questions, the one-time
   connectivity check and the shadow study; about $0.57 was reserved on
   2026-10-30 and nothing since).

   Every paid AI route reads its key through paidAiKey(). It returns the key
   only when the owner has explicitly opted in on the server with
   AEGIS_ALLOW_PAID_AI=true; otherwise none, and each route stops before it
   reserves budget or calls the provider. Removing the opt-in switches paid AI
   off again at the next request. Nothing else in the app needs AI to run:
   the engine, the virtual account and the learner never call it. */

export const PAID_AI_SWITCH = "AEGIS_ALLOW_PAID_AI";

export const PAID_AI_OFF_MESSAGE =
  "Paid AI is switched off to keep this project free. The bot, its trades and its learning do not need it.";

type Env = Record<string, string | undefined>;

export function paidAiAllowed(env: Env = process.env): boolean {
  return env[PAID_AI_SWITCH] === "true";
}

/** The OpenAI key, only when paid AI is explicitly allowed. */
export function paidAiKey(env: Env = process.env): string | undefined {
  return paidAiAllowed(env) ? env.OPENAI_API_SECRET || undefined : undefined;
}
