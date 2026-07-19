/* Versioned localStorage helpers. Everything the app persists lives under
   the `aegis.` prefix; parse failures are treated as absence. */

export function loadStored<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveStored<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or privacy mode — persistence is best-effort */
  }
}

export function removeStored(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const KEYS = {
  presets: "aegis.presets.v1",
  agent: "aegis.forward.v1",
  journal: "aegis.journal.v1",
  legacyAgent: "aegis-paper-agent-v5",
} as const;

export interface StrategyPreset {
  id: string;
  strategyId: string;
  name: string;
  params: Record<string, number | string | boolean>;
  savedAt: number;
}

export function loadPresets(): StrategyPreset[] {
  return loadStored<StrategyPreset[]>(KEYS.presets) ?? [];
}

export function savePresets(presets: StrategyPreset[]): void {
  saveStored(KEYS.presets, presets);
}
