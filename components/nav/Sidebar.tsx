"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const LINKS = [
  { href: "/", label: "Lab", hint: "Tune & backtest" },
  { href: "/compare", label: "Compare", hint: "Side-by-side runs" },
  { href: "/markets", label: "Markets", hint: "Delayed feed & signals" },
  { href: "/data", label: "Data", hint: "CSV import & replay" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark}>◆</span>
        <span>
          Aegis <strong>Futures Lab</strong>
        </span>
      </Link>
      <nav className={styles.nav}>
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={active ? `${styles.link} ${styles.active}` : styles.link}
            >
              <span className={styles.linkLabel}>{l.label}</span>
              <span className={styles.linkHint}>{l.hint}</span>
            </Link>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <span className={styles.lock}>EXECUTION LOCKED</span>
        <span className={styles.footNote}>
          Research edition · delayed data · paper simulation only
        </span>
      </div>
    </aside>
  );
}
