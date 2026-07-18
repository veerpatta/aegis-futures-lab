export function money(v: number, sign = true): string {
  const abs = Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${abs}`;
}

export function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function ratio(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  return v.toFixed(2);
}

export function ts(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateOnly(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
