import s from "./desk.module.css";

/** Decorative illustration; a single entrance, never a pretend live feed. */
export function DeskArtwork({ kind }: { kind: "radar" | "tools" }) {
  return <svg className={s.art} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle cx="60" cy="60" r="51" fill="currentColor" opacity=".05" />
    <circle cx="60" cy="60" r="42" stroke="currentColor" opacity=".16" strokeDasharray="3 6" />
    {kind === "radar" ? <g className={s.draw} stroke="currentColor" strokeWidth="2">
      <circle cx="60" cy="60" r="29" opacity=".4" /><circle cx="60" cy="60" r="15" opacity=".25" />
      <path d="M60 24v72M24 60h72" opacity=".16" /><path d="M60 60 83 37" strokeWidth="3" />
      <circle cx="60" cy="60" r="4" fill="currentColor" /><circle cx="38" cy="79" r="4" fill="currentColor" opacity=".65" />
    </g> : <g className={s.draw} stroke="currentColor" strokeWidth="2">
      <rect x="25" y="35" width="52" height="58" rx="10" fill="var(--bg-raised)" />
      <path d="M37 49h27M37 59h19M37 69h15" opacity=".55" />
      <rect x="62" y="22" width="33" height="39" rx="10" fill="var(--bg-elevated)" />
      <path d="m71 41 5 5 10-12" /><circle cx="81" cy="84" r="15" fill="var(--bg-elevated)" />
      <path d="M81 76v8l5 3" />
    </g>}
  </svg>;
}
