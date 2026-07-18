"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, isActiveLink } from "./links";
import styles from "./Sidebar.module.css";

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
        {NAV_LINKS.map((l) => {
          const active = isActiveLink(l.href, pathname);
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
