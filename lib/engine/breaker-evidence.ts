/** Shared read-only evidence for source pauses. Never a trading decision. */
export const BREAKER_RULES = Object.freeze({ pauseWindow: 20, pausePf: 0.8, resumeWindow: 15, resumePf: 1.1, minClosed: 20, tradingDays: 3 });

export interface BreakerEvidence {
  paused: boolean;
  measuredAt: string;
  pausedAt: string | null;
  triggerReason: string | null;
  triggerPf: number | null;
  triggerWindow: number | null;
  recoveryCount: number;
  recoveryPf: number | null;
  recoveryNoLosses: boolean;
  lastClosedAt: string | null;
  daysSinceFlip: number | null;
  frozen: boolean;
  error?: string;
}

export function parseBreakerEvidence(value: unknown): BreakerEvidence | undefined {
  if (!value || typeof value !== "object") return;
  const b = value as Record<string, unknown>;
  if (typeof b.paused !== "boolean" || typeof b.measuredAt !== "string" || !Number.isFinite(Date.parse(b.measuredAt)) || typeof b.recoveryCount !== "number" || !Number.isFinite(b.recoveryCount) || typeof b.recoveryNoLosses !== "boolean" || typeof b.frozen !== "boolean") return;
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const iso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
  return { paused: b.paused, measuredAt: b.measuredAt, pausedAt: iso(b.pausedAt),
    triggerReason: typeof b.triggerReason === "string" ? b.triggerReason : null,
    triggerPf: number(b.triggerPf), triggerWindow: number(b.triggerWindow),
    recoveryCount: Math.max(0, number(b.recoveryCount) ?? 0), recoveryPf: number(b.recoveryPf), recoveryNoLosses: b.recoveryNoLosses === true,
    lastClosedAt: iso(b.lastClosedAt), daysSinceFlip: number(b.daysSinceFlip), frozen: b.frozen === true,
    ...(typeof b.error === "string" ? { error: b.error } : {}) };
}
