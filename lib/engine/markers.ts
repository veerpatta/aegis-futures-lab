/* Heartbeat markers for parts of an engine pass that can fail without failing
   the run.

   The research observer, the paper and trial brokers, the orphan sweep and
   the excursion writer are all best effort: a failure there must not stop the signal feed,
   so each one is caught and the run still records `ok`. Before this marker
   their failures were free text inside that `ok` heartbeat — nothing alerted on
   them and nothing on screen said so. Now each one is written as

     component_failed[<component>]: <message>

   so the watchdog can alert when one repeats, and the Bot screen can say
   "Needs attention" in plain words. scripts/engine/watchdog.mjs is plain
   JavaScript and keeps its own copy of the token; tests/component-failures
   pins the two together. */

export const COMPONENT_FAILED = "component_failed";

export type EngineComponent =
  | "research-observer"
  | "paper-broker"
  | "trial-broker"
  | "orphan-check"
  | "stale-open"
  | "excursion";

export const COMPONENT_LABELS: Record<EngineComponent, string> = {
  "research-observer": "Strategy testing",
  "paper-broker": "Practice account",
  "trial-broker": "Trial account",
  "orphan-check": "Signal clean-up",
  "stale-open": "Signal clean-up",
  excursion: "Trade measurements",
};

export function componentWarning(component: EngineComponent, err: unknown): string {
  const text = String(err instanceof Error ? err.message : err).replace(/\s+/g, " ").slice(0, 140);
  return `${COMPONENT_FAILED}[${component}]: ${text}`;
}

const PATTERN = new RegExp(`${COMPONENT_FAILED}\\[([a-z-]+)\\]`, "g");

/** Components a heartbeat message reports as failed, in order, de-duplicated. */
export function failedComponents(message: string | null | undefined): EngineComponent[] {
  if (!message) return [];
  const out: EngineComponent[] = [];
  for (const m of message.matchAll(PATTERN)) {
    const c = m[1] as EngineComponent;
    if (c in COMPONENT_LABELS && !out.includes(c)) out.push(c);
  }
  return out;
}
