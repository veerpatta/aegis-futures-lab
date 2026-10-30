"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getNeon } from "@/lib/neon/client";
import page from "@/components/ui/page.module.css";
import styles from "./ai-research.module.css";

type Citation = { id: string; label?: string };
type Budget = { usedUsd?: number; remainingUsd?: number; userRequests?: number; dailyLimit?: number; resetAt?: string; timezone?: string };
type Answer = { answer: string; citations: Citation[]; usage?: Budget };
type User = { id: string; email: string };
type ResearchDepth = "standard" | "deep";
type ShadowSummary = { status: "not-configured" } | { status: "available"; study: { id: string; registeredAt: string; model: string; promptVersion: string; featureVersion: string }; period: { firstObservedAt: string | null; lastObservedAt: string | null }; comparison: { eligible: number; scored: number; resolved: number; abstained: number; taken: number; modelNet: number; takeAllNet: number; noTradeNet: number; randomN: number; randomPercentile: number | null; deltaPerIdea: { est: number; lo: number; hi: number } | null; verdict: string }; rejected: number; invalidated: number; cancelled: number; unresolved: number; assumptions: { costVersion: string; execution: string; source: string; seed: string } };

export async function requestShadowSummary(token: string, transport: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<ShadowSummary> {
  if (!token) throw new Error("Sign in again before checking the study.");
  const response = await transport("/api/ai/shadow/summary", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok || !raw || typeof raw !== "object") throw new Error("Shadow study summary unavailable.");
  const data = raw as Record<string, unknown>;
  if (data.status === "not-configured") return { status: "not-configured" };
  if (data.status !== "available" || !data.study || !data.period || !data.comparison || !data.assumptions || typeof data.study !== "object" || typeof data.period !== "object" || typeof data.comparison !== "object" || typeof data.assumptions !== "object") throw new Error("Shadow study summary unavailable.");
  const study = data.study as Record<string, unknown>, period = data.period as Record<string, unknown>, comparison = data.comparison as Record<string, unknown>, assumptions = data.assumptions as Record<string, unknown>;
  const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  if (!["id", "registeredAt", "model", "promptVersion", "featureVersion"].every(k => typeof study[k] === "string") || !nullableString(period.firstObservedAt) || !nullableString(period.lastObservedAt) || !["eligible", "scored", "resolved", "abstained", "taken", "randomN"].every(k => count(comparison[k])) || !["modelNet", "takeAllNet", "noTradeNet"].every(k => finite(comparison[k])) || !(comparison.randomPercentile === null || finite(comparison.randomPercentile)) || typeof comparison.verdict !== "string" || !["rejected", "invalidated", "cancelled", "unresolved"].every(k => count(data[k])) || !["costVersion", "execution", "source", "seed"].every(k => typeof assumptions[k] === "string")) throw new Error("Shadow study summary unavailable.");
  const interval = comparison.deltaPerIdea;
  if (interval !== null && (!interval || typeof interval !== "object" || !["est", "lo", "hi"].every(k => finite((interval as Record<string, unknown>)[k])))) throw new Error("Shadow study summary unavailable.");
  return raw as ShadowSummary;
}

export function formatBudget(budget: Budget): string {
  let text = `Shared Aegis allowance remaining: $${budget.remainingUsd!.toFixed(2)}`;
  if (typeof budget.usedUsd === "number" && Number.isFinite(budget.usedUsd) && budget.usedUsd >= 0) text += ` · used $${budget.usedUsd.toFixed(2)}`;
  if (budget.resetAt) text += ` · resets ${budget.resetAt}${budget.timezone ? ` ${budget.timezone}` : ""}`;
  text += ".";
  if (Number.isInteger(budget.userRequests) && Number.isInteger(budget.dailyLimit) && budget.userRequests! >= 0 && budget.dailyLimit! >= 0) text += ` Your requests today: ${budget.userRequests} of ${budget.dailyLimit} (UTC).`;
  return `${text} Other applications may have separate charges.`;
}

/** Only the user's question goes to the same-origin service; credentials are
 * sent in a header and never rendered, cached or included in the request body. */
export async function requestResearch(question: string, token: string, transport: (url: string, init: RequestInit) => Promise<Response> = fetch, depth: ResearchDepth = "standard"): Promise<Answer> {
  if (!token) throw new Error("Sign in again before asking.");
  const text = question.trim();
  if (!text || text.length > 2000) throw new Error("Enter a research question of at most 2,000 characters.");
  const response = await transport("/api/ai/research", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: text, depth }),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The research request could not be completed.";
    throw new Error(msg);
  }
  if (!value || typeof value !== "object" || !("answer" in value) || typeof value.answer !== "string") throw new Error("The assistant returned an incomplete response.");
  const raw = value as { answer: string; citations?: unknown; usage?: Budget };
  const citations = Array.isArray(raw.citations) ? raw.citations.flatMap((item): Citation[] => {
    if (typeof item === "string") return [{ id: item }];
    if (item && typeof item === "object" && typeof item.id === "string") return [{ id: item.id, ...(typeof item.label === "string" ? { label: item.label } : {}) }];
    return [];
  }) : [];
  return { answer: raw.answer, citations, usage: raw.usage };
}

export async function requestResearchBudget(token: string, transport: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<Budget> {
  if (!token) throw new Error("Sign in again before checking the budget.");
  const response = await transport("/api/ai/research", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object" || !("usage" in data) || !data.usage || typeof data.usage !== "object") throw new Error("Budget status is unavailable.");
  const usage = data.usage as Budget;
  if (typeof usage.remainingUsd !== "number" || !Number.isFinite(usage.remainingUsd) || usage.remainingUsd < 0) throw new Error("Budget status is unavailable.");
  return usage;
}

/** Signed-in sessions are rechecked before every paid request. */
export default function AIResearch() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const [result, setResult] = useState<Answer | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [budgetFailed, setBudgetFailed] = useState(false);
  const [shadow, setShadow] = useState<ShadowSummary | null>(null);
  const [shadowFailed, setShadowFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentUser = useRef<string | null>(null);
  const request = useRef(0);
  const budgetRequest = useRef(0);

  useEffect(() => {
    const auth = getNeon().auth;
    let alive = true;
    let authVersion = 0;
    const update = (candidate: { id: string; email?: string; is_anonymous?: boolean } | null | undefined) => {
      if (!alive) return;
      const next = candidate?.id && candidate.email && !candidate.is_anonymous ? { id: candidate.id, email: candidate.email } : null;
      if (currentUser.current !== (next?.id ?? null)) {
        request.current++;
        setResult(null); setQuestion(""); setDepth("standard"); setError(""); setBusy(false);
      }
      currentUser.current = next?.id ?? null;
      setUser(next); setChecking(false);
    };
    void auth.getSession().then(({ data }) => { if (authVersion === 0) update(data.session?.user); }).catch(() => { if (alive && authVersion === 0) setChecking(false); });
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => { authVersion++; update(session?.user); });
    return () => { alive = false; request.current++; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const version = ++budgetRequest.current;
    setBudget(null); setBudgetFailed(false);
    if (!user) return () => { alive = false; };
    void (async () => {
      try {
        const { data, error: authError } = await getNeon().auth.getSession();
        if (authError || !data.session?.access_token || data.session.user?.id !== user.id) throw new Error("Session unavailable");
        const next = await requestResearchBudget(data.session.access_token);
        if (alive && budgetRequest.current === version) setBudget(next);
      } catch { if (alive && budgetRequest.current === version) setBudgetFailed(true); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    setShadow(null); setShadowFailed(false);
    if (!user) return () => { alive = false; };
    void (async () => {
      try {
        const { data, error: authError } = await getNeon().auth.getSession();
        if (authError || !data.session?.access_token || data.session.user?.id !== user.id) throw new Error("Session unavailable");
        const next = await requestShadowSummary(data.session.access_token);
        if (alive) setShadow(next);
      } catch { if (alive) setShadowFailed(true); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const sendCode = async () => {
    const value = email.trim();
    if (!value || !value.includes("@")) { setMessage("Enter a valid email address."); return; }
    setAuthBusy(true); setMessage("");
    try {
      const { error: authError } = await getNeon().auth.signInWithOtp({ email: value });
      if (authError) throw authError;
      setCodeSent(true); setMessage("Check your email for the six-digit code.");
    } catch { setMessage("Could not send the code. Try again."); }
    finally { setAuthBusy(false); }
  };

  const verifyCode = async () => {
    if (!/^\d{6}$/.test(code)) { setMessage("Enter the six-digit code from your email."); return; }
    setAuthBusy(true); setMessage("");
    try {
      const { data, error: authError } = await getNeon().auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
      if (authError) throw authError;
      if (!data.user?.id || !data.user.email || data.user.is_anonymous) throw new Error("No signed-in account");
      if (currentUser.current !== data.user.id) { request.current++; setResult(null); setQuestion(""); setDepth("standard"); setError(""); }
      currentUser.current = data.user.id;
      setUser({ id: data.user.id, email: data.user.email });
      setCode(""); setCodeSent(false); setMessage("");
    } catch { setMessage("The code could not be verified. Check it and try again."); }
    finally { setAuthBusy(false); }
  };

  const signOut = async () => {
    try {
      const { error: authError } = await getNeon().auth.signOut();
      if (authError) throw authError;
    } catch { setError("Could not sign out. Try again."); }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) { setError("Enter a research question."); return; }
    if (!navigator.onLine) { setError("You are offline. Reconnect before asking."); return; }
    const id = ++request.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const { data, error: authError } = await getNeon().auth.getSession();
      const session = data.session;
      if (authError || !session?.access_token || !session.user?.email || session.user.is_anonymous || session.user.id !== currentUser.current) throw new Error("Sign in again before asking.");
      const value = await requestResearch(text, session.access_token, fetch, depth);
      if (id === request.current) {
        setResult(value);
        if (typeof value.usage?.remainingUsd === "number" && Number.isFinite(value.usage.remainingUsd) && value.usage.remainingUsd >= 0) { budgetRequest.current++; setBudget(value.usage); setBudgetFailed(false); }
      }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Research is unavailable. Try again later.");
    } finally { if (id === request.current) setBusy(false); }
  };

  return <section className={`${page.card} ${styles.research}`} aria-label="AI research assistant">
    <div><h2 className={page.cardTitle}>AI research assistant</h2><p className={page.paperLine}>Virtual only · Delayed data · Research, not trading advice</p></div>
    <p className={page.note}>Ask about recorded evidence or suggest a new research question. AI can be wrong; a cited record does not prove a claim. It cannot change trades or the bot&apos;s rules.</p>
    <p className={page.note}>Your question is sent to OpenAI. Do not include passwords, API keys or private journal details. Signed-in users share the $25 monthly Aegis allowance.</p>
    {checking ? <p className={page.loading}>Checking sign-in…</p> : !user ? <div className={styles.signIn}>
      <p>Sign in with email to use paid research.</p>
      <label>Email <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <button type="button" onClick={() => void sendCode()} disabled={authBusy}>{authBusy ? "Please wait…" : "Send code"}</button>
      {codeSent && <><label>Six-digit code <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label><button type="button" onClick={() => void verifyCode()} disabled={authBusy}>Sign in</button></>}
      {message && <p role="status" className={page.note}>{message}</p>}
    </div> : <>
      <p className={page.note}>Signed in as {user.email}. Your questions and answers belong to your account.</p>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
      <form onSubmit={event => void ask(event)} className={styles.form}>
        <label htmlFor="aegis-ai-question">Research question</label>
        <textarea id="aegis-ai-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={4} placeholder="Why are the source methods paused?" disabled={busy} />
        <fieldset disabled={busy}>
          <legend>Research depth</legend>
          <label><input type="radio" name="research-depth" value="standard" checked={depth === "standard"} onChange={() => setDepth("standard")} /> Standard (GPT-6.1 Sol)</label>{" "}
          <label><input type="radio" name="research-depth" value="deep" checked={depth === "deep"} onChange={() => setDepth("deep")} /> Deeper research (GPT-6 Astra)</label>
          <p className={page.note}>Deeper research can use more of the shared monthly allowance and is available only when the budget permits.</p>
        </fieldset>
        <div className={styles.actions}><span className={page.dim}>{question.length}/2000</span><button type="submit" disabled={busy || !question.trim()}>{busy ? "Checking evidence…" : "Ask assistant"}</button></div>
      </form>
      {error && <p role="alert" className={page.warning}>{error}</p>}
      {result && <article className={styles.response} aria-live="polite"><h3 className={page.cardTitle}>Research response</h3><p className={styles.answer}>{result.answer}</p>
        {result.citations.length > 0 ? <><h4>Records referenced</h4><ul>{result.citations.map((c, i) => <li key={`${c.id}-${i}`}>{c.label ? `${c.label} · ` : ""}{c.id}</li>)}</ul></> : <p className={page.note}>No validated records were supplied with this response.</p>}
        <p className={page.note}>References identify supplied records; they do not guarantee the answer is correct.</p>
      </article>}
      <p className={page.note}>{budget ? formatBudget(budget) : budgetFailed ? "Shared budget status is unavailable. Paid requests may be paused." : "Checking shared budget…"}</p>
      <section aria-label="Separate paper shadow study">
        <h3 className={page.cardTitle}>Separate paper shadow study</h3>
        {!shadow ? <p className={page.note}>{shadowFailed ? "Study summary unavailable. Try again later." : "Checking study summary…"}</p> : shadow.status === "not-configured" ? <p className={page.note}>No shadow study is configured yet.</p> : <>
          <p className={page.note}>Inconclusive: this prospective study is virtual and cannot establish profitable real trading. It does not change the learner or account.</p>
          <p className={page.note}>Study {shadow.study.id} · registered {shadow.study.registeredAt} · {shadow.study.model} · prompt {shadow.study.promptVersion} · features {shadow.study.featureVersion}</p>
          <p className={page.note}>Observation period: {shadow.period.firstObservedAt && shadow.period.lastObservedAt ? `${shadow.period.firstObservedAt} to ${shadow.period.lastObservedAt}` : "No observations yet"}.</p>
          <p className={page.note}>Eligible {shadow.comparison.eligible} · rejected {shadow.rejected} · scored {shadow.comparison.scored} · resolved {shadow.comparison.resolved} · abstained {shadow.comparison.abstained} · taken {shadow.comparison.taken} · unresolved {shadow.unresolved} · invalidated {shadow.invalidated} · cancelled {shadow.cancelled}.</p>
          <p className={page.note}>Comparable simulated net USD: model ${shadow.comparison.modelNet.toFixed(2)} · take all ${shadow.comparison.takeAllNet.toFixed(2)} · no trade ${shadow.comparison.noTradeNet.toFixed(2)}. Matched random comparison: {shadow.comparison.randomPercentile === null ? "not available" : `${shadow.comparison.randomPercentile.toFixed(1)}th percentile, ${shadow.comparison.randomN} model selections`}.</p>
          <p className={page.note}>{shadow.comparison.deltaPerIdea ? `Estimated model minus take-all per idea: $${shadow.comparison.deltaPerIdea.est.toFixed(2)}; 95% session bootstrap interval $${shadow.comparison.deltaPerIdea.lo.toFixed(2)} to $${shadow.comparison.deltaPerIdea.hi.toFixed(2)}.` : "Uncertainty interval unavailable; more resolved sessions are needed."} Unscored and unresolved cases are excluded from all comparisons.</p>
          <p className={page.note}>Assumptions: {shadow.assumptions.execution}; {shadow.assumptions.source} delayed data; costs {shadow.assumptions.costVersion}. One contract per opportunity; these are not portfolio returns.</p>
        </>}
      </section>
    </>}
  </section>;
}
