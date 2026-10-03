"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MORE_GROUPS, NAV_LINKS, isActiveLink, type NavLink } from "./links";
import ZoneToggle from "./ZoneToggle";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const pathname = usePathname();

  const renderLink = (l: NavLink) => {
    const active = isActiveLink(l.href, pathname);
    return (
      <Link
        key={l.href}
        href={l.href}
        className={active ? `${styles.link} ${styles.active}` : styles.link}
        aria-current={active ? "page" : undefined}
      >
        <span className={styles.linkIcon}>{l.icon}</span>
        <span className={styles.linkText}>
          <span className={styles.linkLabel}>{l.label}</span>
          <span className={styles.linkHint}>{l.hint}</span>
        </span>
      </Link>
    );
  };

  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandMark}>◆</span>
        <span className={styles.brandText}>
          <strong>Aegis</strong>
          <span className={styles.brandSub}>Futures research</span>
        </span>
      </Link>

      <nav className={styles.nav}>
        {/* The /more hub is a phone screen; on desktop its groups are listed here. */}
        {NAV_LINKS.filter((l) => l.href !== "/more").map(renderLink)}
        {MORE_GROUPS.map((g) => (
          <div key={g.title} className={styles.group}>
            <span className={styles.groupLabel}>{g.title}</span>
            {g.links.map(renderLink)}
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.zoneRow}>
          <span className={styles.zoneLabel}>Times in</span>
          <ZoneToggle />
        </div>
        <span className={styles.lock}>PAPER TRADING</span>
        <span className={styles.footNote}>
          Delayed data · simulation only · no broker connection
        </span>
      </div>
    </aside>
  );
}
