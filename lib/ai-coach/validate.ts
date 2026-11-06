/* Accept a coach note only if it says nothing the record does not.

   - Every number in the note must match a number in the facts, allowing for
     commas, "$" and "%", a dropped sign ("lost $111.89" for -111.89) and the
     note's own rounding (111.89 may be written 112 or 111.9).
   - No advice and no certainty ("guarantee", "you should buy", "will profit").
   - It must say the money is virtual, and stay short.
   A rejected note is stored for audit but never shown; the app's own sentence
   is shown instead. */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export type NoteKind = "trade" | "day";
export type Verdict = { ok: true } | { ok: false; reason: string };

const FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /\bguarantee/i, reason: "certainty" },
  { re: /\brisk[- ]free\b/i, reason: "certainty" },
  { re: /\bwill (?:surely |definitely )?(?:make|earn|profit|win|gain|rise|fall|go up|go down)\b/i, reason: "prediction" },
  { re: /\byou should\b|\byou must\b|\bi recommend\b|\bwe recommend\b/i, reason: "advice" },
  { re: /\b(?:buy|sell) now\b/i, reason: "advice" },
  { re: /\bfinancial advice\b/i, reason: "advice" },
  { re: /https?:\/\/|www\./i, reason: "link" },
  { re: /[<>`*#|]/, reason: "markup" },
];

function decimals(token: string): number {
  const dot = token.indexOf(".");
  return dot < 0 ? 0 : token.length - dot - 1;
}

/** Every number in a facts object, including numbers written inside strings
    ("Fri 10:10", "2026-11-06"). */
export function factNumbers(facts: unknown, out: number[] = []): number[] {
  if (typeof facts === "number" && Number.isFinite(facts)) out.push(Math.abs(facts));
  else if (typeof facts === "string") for (const m of facts.match(NUMBER) ?? []) out.push(Number(m.replace(/,/g, "")));
  else if (facts && typeof facts === "object") for (const v of Object.values(facts)) factNumbers(v, out);
  return out;
}

function supported(token: string, pool: number[]): boolean {
  const value = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(value)) return false;
  const dp = Math.min(decimals(token), 6);
  const f = 10 ** dp;
  return pool.some((p) => Math.abs(Math.round(p * f) / f - value) < 1e-9);
}

export function validateNote(text: string, facts: unknown, kind: NoteKind): Verdict {
  const note = text.trim();
  const max = kind === "trade" ? 700 : 900;
  if (note.length < 40 || note.length > max) return { ok: false, reason: "length" };
  const sentences = note.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
  if (sentences > (kind === "trade" ? 4 : 5)) return { ok: false, reason: "too-many-sentences" };
  for (const f of FORBIDDEN) if (f.re.test(note)) return { ok: false, reason: f.reason };
  if (!/\b(?:virtual|practice|simulated|paper)\b/i.test(note)) return { ok: false, reason: "not-labelled-virtual" };
  const pool = factNumbers(facts);
  for (const token of note.match(NUMBER) ?? []) if (!supported(token, pool)) return { ok: false, reason: "unsupported-number" };
  return { ok: true };
}
