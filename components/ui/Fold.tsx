"use client";

/* A folded section that renders (and fetches) its content only once opened.
   The research-heavy parts of Trades and Learn live in these, so the main
   screens stay short and a closed fold costs no database read. Opens by
   itself when the page's hash names it (for links such as /brain#research). */

import { useEffect, useRef, useState, type ReactNode } from "react";
import page from "./page.module.css";

export default function Fold({ id, summary, children, className }: { id?: string; summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!id) return;
    const sync = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true;
        setOpen(true);
        ref.current.scrollIntoView({ block: "start" });
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);
  return (
    <details ref={ref} id={id} className={`${page.details} ${className ?? ""}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}
