"use client";

/* Phone tab bar (≤768px): the five primary screens, on glass, with an accent
   indicator that slides to the active tab. Desktop keeps the Sidebar.

   Pages reached through More (Journal, Guide, Lab, …) light up the More tab,
   so you always know where you are and how to get back. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_LINKS, activeTabIndex, isActiveLink } from "./links";
import styles from "./MobileNav.module.css";

export function MobileTabBar() {
  const pathname = usePathname();
  const activeIndex = activeTabIndex(pathname);
  const width = 100 / MOBILE_LINKS.length;

  return (
    <nav className={styles.tabBar} aria-label="Primary">
      {activeIndex >= 0 && (
        <i
          className={styles.indicator}
          style={{ width: `${width}%`, transform: `translateX(${activeIndex * 100}%)` }}
          aria-hidden
        />
      )}
      {MOBILE_LINKS.map((l, i) => {
        const active = i === activeIndex;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? `${styles.tab} ${styles.tabActive} pressLg` : `${styles.tab} pressLg`}
            aria-current={isActiveLink(l.href, pathname) ? "page" : undefined}
          >
            {l.icon}
            <span className={styles.tabLabel}>{l.shortLabel ?? l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
