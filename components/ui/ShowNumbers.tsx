"use client";

/* The research numbers, one tap away.

   Every screen leads with a plain sentence; profit factor, win rate, likely
   ranges and the rest sit behind this disclosure. It hides numbers, never the
   verdict: a sentence that says "lost money" stays on screen above it. Rates
   inside still go through Rate / SampleNote / Kpi n= (design-language §6). */

import { useId, useState } from "react";
import styles from "./plain.module.css";

export default function ShowNumbers({
  children,
  label = "Show the numbers",
  hideLabel = "Hide the numbers",
  defaultOpen = false,
}: {
  children: React.ReactNode;
  label?: string;
  hideLabel?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={styles.numbers}>
      <button
        type="button"
        className={styles.numbersToggle}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? hideLabel : label}</span>
        <span aria-hidden className={open ? styles.chevronUp : styles.chevron}>
          ⌄
        </span>
      </button>
      <div id={id} hidden={!open} className={styles.numbersBody}>
        {open && children}
      </div>
    </div>
  );
}
