"use client";

/* The ET / IST switch. Small, always visible, and it never hides which clock
   you are looking at — the chosen zone's abbreviation is repeated next to
   times throughout the app. */

import { useZone } from "@/components/providers/ZoneProvider";
import { DISPLAY_ZONES, ZONE_NAME, type DisplayZone } from "@/lib/time/zones";
import styles from "./ZoneToggle.module.css";

export default function ZoneToggle({ className }: { className?: string }) {
  const { zone, setZone } = useZone();
  return (
    <div
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
      role="group"
      aria-label="Show times in"
    >
      {DISPLAY_ZONES.map((z: DisplayZone) => (
        <button
          key={z}
          type="button"
          className={z === zone ? `${styles.opt} ${styles.on}` : styles.opt}
          aria-pressed={z === zone}
          title={`Show all times in ${ZONE_NAME[z]}`}
          onClick={() => setZone(z)}
        >
          {z}
        </button>
      ))}
    </div>
  );
}
