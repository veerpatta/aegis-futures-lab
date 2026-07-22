"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_LINKS, isActiveLink } from "./links";
import ZoneToggle from "./ZoneToggle";
import styles from "./MobileNav.module.css";

/* Phone navigation (≤768px): a slim in-flow top bar carrying the brand and
   the compliance badge, plus a fixed bottom tab bar with the five primary
   pages. Desktop keeps the Sidebar; both bars are display:none above 768px.
   Home renders its own richer header, so the top bar stands down there. */

export function MobileTopBar() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <header className={styles.topBar}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark}>◆</span>
        <span>
          Aegis <strong>Futures Lab</strong>
        </span>
      </Link>
      <span className={styles.topBarEnd}>
        <ZoneToggle />
        <span className={styles.lock}>PAPER TRADING</span>
      </span>
    </header>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabBar} aria-label="Primary">
      {MOBILE_LINKS.map((l) => {
        const active = isActiveLink(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={active ? "page" : undefined}
          >
            {l.icon}
            <span className={styles.tabLabel}>{l.shortLabel ?? l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
