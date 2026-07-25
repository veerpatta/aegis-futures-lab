"use client";

/* The app header — one glass bar across every screen.

   The native pass replaced the old split (a phone top bar that stood down on
   Home, plus Home's own bespoke brand block) with a single persistent header:
   brand mark, the screen's name, the date and paper-trading reminder, then the
   three global controls — clock zone, privacy, alerts.

   On desktop the sidebar already carries the brand and the nav, so the mark is
   dropped there and the bar becomes a slim strip holding the screen name and
   the same three controls. The controls are global state, so they belong in
   one place rather than being repeated per page. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, SECONDARY_LINKS } from "./links";
import ZoneToggle from "./ZoneToggle";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { dayLabel } from "@/lib/time/session";
import BottomSheet, { SheetClose } from "@/components/ui/BottomSheet";
import styles from "./AppHeader.module.css";

/* Home's title is the product name; every other screen uses its nav label. */
function screenTitle(pathname: string): string {
  if (pathname === "/") return "Aegis";
  const all = [...NAV_LINKS, ...SECONDARY_LINKS];
  const hit = all.find((l) => l.href !== "/" && pathname.startsWith(l.href));
  return hit?.label ?? "Aegis";
}

export default function AppHeader() {
  const pathname = usePathname();
  const { privacy, toggle } = usePrivacy();
  const { alerts } = useBotHealth();
  const { zone } = useZone();
  const [bellOpen, setBellOpen] = useState(false);
  /* null on the server and on first paint; the date lands after mount so the
     markup hydrates identically in every timezone. */
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const title = screenTitle(pathname);
  /* null until the client clock mounts, so the markup hydrates identically. */
  const dateLine = now === null ? "paper" : `${dayLabel(now, zone)} · paper`;

  return (
    <>
      <header className={styles.bar}>
        <Link href="/" className={styles.brand} aria-label="Aegis home">
          <span className={styles.mark} aria-hidden>
            ◆
          </span>
          <span className={styles.brandText}>
            <span className={styles.title}>{title}</span>
            <span className={styles.sub}>{dateLine}</span>
          </span>
        </Link>

        <div className={styles.actions}>
          {/* Phone only — on desktop the sidebar footer keeps the labelled
              "Times in ET / IST" row, and two copies of one switch in view at
              once reads as two settings. */}
          <ZoneToggle className={styles.zone} />

          <button
            type="button"
            className={`${styles.iconBtn} press`}
            onClick={toggle}
            aria-pressed={privacy}
            title={privacy ? "Show money figures" : "Hide money figures"}
            aria-label={privacy ? "Show money figures" : "Hide money figures"}
          >
            {privacy ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                <path d="M2 12s3.6-6.5 10-6.5c1.5 0 2.9.25 4.1.66M22 12s-3.6 6.5-10 6.5c-1.6 0-3-.26-4.2-.7" />
                <path d="M4 4l16 16" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className={`${styles.iconBtn} press`}
            onClick={() => setBellOpen(true)}
            aria-label={
              alerts.length === 0
                ? "Bot alerts — nothing to report"
                : `Bot alerts — ${alerts.length} to review`
            }
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
              <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
              <path d="M10.5 19.5a2 2 0 0 0 3 0" />
            </svg>
            {alerts.length > 0 && <i className={styles.dot} aria-hidden />}
          </button>
        </div>
      </header>

      <BottomSheet open={bellOpen} onClose={() => setBellOpen(false)} title="Bot alerts">
        <div className={styles.sheetHead}>
          <b className={styles.sheetTitle}>Bot alerts</b>
          <SheetClose onClose={() => setBellOpen(false)} />
        </div>
        {alerts.length === 0 ? (
          <p className={styles.sheetEmpty}>
            Nothing to report — the bot is checking in on time and no stream is paused.
          </p>
        ) : (
          <ul className={styles.alertList}>
            {alerts.map((a) => (
              <li key={a.id} className={styles.alert}>
                <i className={`${styles.alertDot} ${styles[a.tone]}`} aria-hidden />
                {a.text}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.sheetNote}>
          Paper trading on delayed data — nothing here places an order or touches real money.
        </p>
      </BottomSheet>
    </>
  );
}
