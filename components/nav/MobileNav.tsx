"use client";

/* Phone tab bar (≤768px): the five primary screens, on glass, with an accent
   indicator that slides to the active tab. Desktop keeps the Sidebar.

   The old MobileTopBar lived here too; the native pass folded it into
   AppHeader, which now renders on every route and both breakpoints. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_LINKS, isActiveLink } from "./links";
import styles from "./MobileNav.module.css";

export function MobileTabBar() {
  const pathname = usePathname();
  const activeIndex = MOBILE_LINKS.findIndex((l) => isActiveLink(l.href, pathname));

  return (
    <nav className={styles.tabBar} aria-label="Primary">
      {/* Hidden when no tab matches (e.g. /brain, /compare) so the indicator
          never parks on a tab you are not actually on. */}
      {activeIndex >= 0 && (
        <i
          className={styles.indicator}
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
          aria-hidden
        />
      )}
      {MOBILE_LINKS.map((l) => {
        const active = isActiveLink(l.href, pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active ? `${styles.tab} ${styles.tabActive} pressLg` : `${styles.tab} pressLg`
            }
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
