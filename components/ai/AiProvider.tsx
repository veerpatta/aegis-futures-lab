"use client";

/* The free AI helper's data for every screen (docs/AI-HELPER.md).

   Two reads, kept apart on purpose:
   - the public scoreboard (/api/ai/scoreboard): numbers our own code computes
     from the bot's records, cached by the CDN for five minutes;
   - the owner's AI words (/api/ai/owner): the AI's second opinions and plain
     notes. NVIDIA's free trial terms do not allow showing AI-written text to
     the public, so the server releases it only to the signed-in owner.

   Neither read can change the bot. A failed read hides the AI parts and the
   screens fall back to the app's own wording. Polling follows the app's
   shared rhythm (a hidden tab never polls). */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";
import { callForDecision, primaryStudy, type AiCall, type AiIdea, type AiIdeaCondition, type AiIdeaScore, type AiNote, type AiStudyScore } from "@/lib/plain/ai";

export type OwnerAiStatus = "signed-out" | "checking" | "ready" | "not-owner" | "unavailable";

interface AiState {
  /** null until the first read; studies empty when the helper is not set up. */
  scoreboard: { available: boolean; updatedAt: string | null; studies: AiStudyScore[]; ideas: AiIdeaScore[] } | null;
  primary: AiStudyScore | null;
  ownerStatus: OwnerAiStatus;
  calls: AiCall[];
  notes: AiNote[];
  /** Owner-only: what each AI research idea says (keyed like the public scores). */
  ideas: AiIdea[];
  callFor: (decisionKey: string) => AiCall | null;
  noteFor: (kind: AiNote["kind"], subject: string) => AiNote | null;
  refresh: () => void;
}

const Context = createContext<AiState>({
  scoreboard: null, primary: null, ownerStatus: "signed-out", calls: [], notes: [], ideas: [],
  callFor: () => null, noteFor: () => null, refresh: () => {},
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
/** A look still waiting for its calls to finish reads as "too early": never a verdict before the evidence is final. */
const verdictOf = (v: unknown): AiStudyScore["verdict"] | null =>
  v === "waiting" ? "too-early" : v === "too-early" || v === "inconclusive" || v === "pass" || v === "fail" ? v : null;

/** Accept only the documented scoreboard shape; anything else is "not available". */
export function parseScoreboard(raw: unknown): AiState["scoreboard"] {
  if (!isObj(raw) || typeof raw.available !== "boolean" || !Array.isArray(raw.studies)) return null;
  const studies: AiStudyScore[] = [];
  for (const s of raw.studies) {
    if (!isObj(s) || !str(s.id) || !str(s.label) || !str(s.model) || !["active", "waiting-for-model"].includes(String(s.status))) continue;
    if (![s.calls, s.resolved, s.taken, s.skipped, s.sessions].every(count) || !finite(s.aiNet) || !finite(s.takeAllNet)) continue;
    const verdict = verdictOf(s.verdict);
    if (!verdict) continue;
    const delta = isObj(s.delta) && finite(s.delta.est) && finite(s.delta.lo) && finite(s.delta.hi) ? { est: s.delta.est, lo: s.delta.lo, hi: s.delta.hi } : null;
    studies.push({
      id: s.id, label: s.label, model: s.model, status: s.status as AiStudyScore["status"],
      startedAt: str(s.startedAt) ? s.startedAt : null,
      calls: s.calls as number, resolved: s.resolved as number, taken: s.taken as number, skipped: s.skipped as number, sessions: s.sessions as number,
      aiNet: s.aiNet, takeAllNet: s.takeAllNet,
      randomPercentile: finite(s.randomPercentile) ? s.randomPercentile : null,
      delta, verdict,
      nextLook: s.nextLook === 60 || s.nextLook === 150 ? s.nextLook : null,
      waiting: str(s.waiting) ? s.waiting.slice(0, 200) : null,
    });
  }
  const ideas: AiIdeaScore[] = [];
  for (const s of Array.isArray(raw.ideas) ? raw.ideas : []) {
    if (!isObj(s) || !str(s.id) || !str(s.proposedAt) || !str(s.model) || !["testing", "retired"].includes(String(s.status))) continue;
    if (![s.tested, s.resolved, s.skipped, s.sessions].every(count) || !finite(s.keptNet) || !finite(s.takeAllNet)) continue;
    const verdict = verdictOf(s.verdict);
    if (!verdict) continue;
    const delta = isObj(s.delta) && finite(s.delta.est) && finite(s.delta.lo) && finite(s.delta.hi) ? { est: s.delta.est, lo: s.delta.lo, hi: s.delta.hi } : null;
    ideas.push({
      id: s.id, proposedAt: s.proposedAt, model: s.model, status: s.status as AiIdeaScore["status"],
      tested: s.tested as number, resolved: s.resolved as number, skipped: s.skipped as number, sessions: s.sessions as number,
      keptNet: s.keptNet, takeAllNet: s.takeAllNet, delta, randomPercentile: finite(s.randomPercentile) ? s.randomPercentile : null,
      verdict, nextLook: s.nextLook === 60 || s.nextLook === 150 ? s.nextLook : null,
      waiting: str(s.waiting) ? s.waiting.slice(0, 200) : null,
    });
  }
  return { available: raw.available, updatedAt: str(raw.updatedAt) ? raw.updatedAt : null, studies, ideas };
}

const OPS = new Set(["<", ">", "=", "!="]);
/** Owner-only rule text; a malformed rule is dropped, never shown half-parsed. */
function parseIdeas(raw: unknown): AiIdea[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i): AiIdea[] => {
    if (!isObj(i) || !str(i.id) || !str(i.name) || !str(i.why) || !str(i.proposedAt) || !str(i.model) || !Array.isArray(i.when) || !i.when.length || i.when.length > 3) return [];
    const when = i.when.flatMap((c): AiIdeaCondition[] =>
      isObj(c) && str(c.field) && OPS.has(String(c.op)) && (str(c.value) || finite(c.value) || typeof c.value === "boolean")
        ? [{ field: c.field, op: c.op as AiIdeaCondition["op"], value: c.value as AiIdeaCondition["value"] }] : []);
    return when.length === i.when.length ? [{ id: i.id, name: i.name.slice(0, 80), why: i.why.slice(0, 400), when, proposedAt: i.proposedAt, model: i.model }] : [];
  });
}

/** Accept only well-formed calls, notes and ideas; drop the rest silently. */
export function parseOwnerAi(raw: unknown): { calls: AiCall[]; notes: AiNote[]; ideas: AiIdea[] } | null {
  if (!isObj(raw) || !Array.isArray(raw.calls) || !Array.isArray(raw.notes)) return null;
  const calls = raw.calls.flatMap((c): AiCall[] =>
    isObj(c) && str(c.decisionKey) && str(c.studyId) && str(c.model) && (c.decision === "take" || c.decision === "skip") &&
    finite(c.confidence) && str(c.reason) && str(c.calledAt)
      ? [{ decisionKey: c.decisionKey, studyId: c.studyId, model: c.model, decision: c.decision, confidence: c.confidence, reason: c.reason.slice(0, 600), calledAt: c.calledAt }]
      : []);
  const notes = raw.notes.flatMap((n): AiNote[] =>
    isObj(n) && (n.kind === "trade" || n.kind === "day" || n.kind === "week") && str(n.subject) && str(n.text) && str(n.model) && str(n.createdAt)
      ? [{ kind: n.kind, subject: n.subject, text: n.text.slice(0, 1200), model: n.model, createdAt: n.createdAt }]
      : []);
  return { calls, notes, ideas: parseIdeas(raw.ideas) };
}

export function AiProvider({ children }: { children: React.ReactNode }) {
  const [scoreboard, setScoreboard] = useState<AiState["scoreboard"]>(null);
  const [ownerStatus, setOwnerStatus] = useState<OwnerAiStatus>("signed-out");
  const [owner, setOwner] = useState<{ calls: AiCall[]; notes: AiNote[]; ideas: AiIdea[] }>({ calls: [], notes: [], ideas: [] });
  const signedIn = useRef(false);
  const busy = useRef(false);

  const loadScoreboard = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/scoreboard", { headers: { Accept: "application/json" } });
      const parsed = res.ok ? parseScoreboard(await res.json().catch(() => null)) : null;
      setScoreboard(parsed ?? { available: false, updatedAt: null, studies: [], ideas: [] });
    } catch {
      setScoreboard((prev) => prev ?? { available: false, updatedAt: null, studies: [], ideas: [] });
    }
  }, []);

  const loadOwner = useCallback(async () => {
    if (!signedIn.current || busy.current) return;
    busy.current = true;
    try {
      const { data, error } = await getNeon().auth.getSession();
      const token = data.session?.access_token;
      if (error || !token || data.session?.user?.is_anonymous) { setOwnerStatus("signed-out"); return; }
      setOwnerStatus((s) => (s === "ready" ? s : "checking"));
      const res = await fetch("/api/ai/owner", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (res.status === 401 || res.status === 403) { setOwnerStatus("not-owner"); setOwner({ calls: [], notes: [], ideas: [] }); return; }
      const parsed = res.ok ? parseOwnerAi(await res.json().catch(() => null)) : null;
      if (!parsed) { setOwnerStatus("unavailable"); return; }
      setOwner(parsed);
      setOwnerStatus("ready");
    } catch {
      setOwnerStatus("unavailable");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void loadScoreboard();
    let alive = true;
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const auth = getNeon().auth;
      void auth.getSession().then(({ data }) => {
        if (!alive) return;
        signedIn.current = !!data.session?.access_token && !data.session.user?.is_anonymous;
        if (signedIn.current) void loadOwner();
      }).catch(() => {});
      subscription = auth.onAuthStateChange((_event, session) => {
        signedIn.current = !!session?.access_token && !session.user?.is_anonymous;
        if (signedIn.current) void loadOwner();
        else { setOwnerStatus("signed-out"); setOwner({ calls: [], notes: [], ideas: [] }); }
      }).data.subscription;
    } catch {
      /* No auth client (tests, offline): AI words simply stay hidden. */
    }
    return () => { alive = false; subscription?.unsubscribe(); };
  }, [loadScoreboard, loadOwner]);

  const refresh = useCallback(() => { void loadScoreboard(); void loadOwner(); }, [loadScoreboard, loadOwner]);
  useLiveRefresh(refresh, 5 * 60_000);

  const value = useMemo<AiState>(() => {
    const primary = primaryStudy(scoreboard?.studies ?? []);
    return {
      scoreboard, primary, ownerStatus, calls: owner.calls, notes: owner.notes, ideas: owner.ideas,
      callFor: (key) => callForDecision(owner.calls, key, primary?.id),
      noteFor: (kind, subject) => owner.notes.find((n) => n.kind === kind && n.subject === subject) ?? null,
      refresh,
    };
  }, [scoreboard, ownerStatus, owner, refresh]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useAi = () => useContext(Context);
