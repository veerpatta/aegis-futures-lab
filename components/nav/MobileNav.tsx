"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, isActiveLink } from "./links";
import styles from "./MobileNav.module.css";

/* Phone navigation (≤768px): a slim in-flow top bar carrying the brand and
   the compliance badge, plus a fixed bottom tab bar with the four pages.
   Desktop keeps the Sidebar; both bars are display:none above 768px. */

export function MobileTopBar() {
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark}>◆</span>
        <span>
          Aegis <strong>Futures Lab</strong>
        </span>
      </Link>
      <span className={styles.lock}>EXECUTION LOCKED</span>
    </header>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabBar} aria-label="Primary">
      {NAV_LINKS.map((l) => {
        const active = isActiveLink(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={active ? "page" : undefined}
          >
            {l.icon}
            <span className={styles.tabLabel}>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
