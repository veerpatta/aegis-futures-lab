/* Text from a model, made safe to store.

   Postgres text and jsonb refuse NUL characters, and a lone surrogate (half of
   an emoji cut in two) breaks JSON and UTF-8 storage. Strip both, and cut by
   code points so a limit never splits a character. */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanText(value: string, maxCodePoints: number): string {
  const clean = value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "");
  const points = Array.from(clean);
  return points.length > maxCodePoints ? points.slice(0, maxCodePoints).join("") : clean;
}

/** Like cleanText, but marks a cut with an ellipsis inside the limit. */
export function clipText(value: string, maxCodePoints: number): string {
  const clean = cleanText(value, Number.MAX_SAFE_INTEGER);
  const points = Array.from(clean);
  return points.length > maxCodePoints ? `${points.slice(0, Math.max(0, maxCodePoints - 3)).join("")}...` : clean;
}
