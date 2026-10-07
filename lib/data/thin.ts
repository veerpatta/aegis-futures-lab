/** Evenly thin a series to at most `max` points, always keeping the first and the newest. */
export function thinBars<T>(bars: T[], max = 120): T[] {
  if (bars.length <= max || max < 2) return bars;
  const step = (bars.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(bars[Math.round(i * step)]);
  return out;
}
