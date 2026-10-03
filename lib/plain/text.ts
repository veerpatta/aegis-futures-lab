/** Capitalise the first letter of each sentence — for engine-built sentences
    that join lower-case clauses with ". " (lib/signals/daily-funnel.ts). */
export function sentenceCase(text: string): string {
  return text.replace(/(^|\. )([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase());
}
