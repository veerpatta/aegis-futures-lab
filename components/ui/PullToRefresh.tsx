"use client";

/* Pull down at the top of any screen to refresh — phones only.

   An installed app has no reload button and the browser's own pull-to-refresh
   reloads the whole page (body has overscroll-behavior-y: contain, so it is
   off). This one refreshes the data in place: the health check, the ideas, the
   practice and trial accounts and the quotes all listen for requestRefresh().

   Ignored inside sheets and anything marked data-no-pull (the chart), and
   only when the page is scrolled to the very top. Under reduced motion the
   strip appears without sliding. */

import { useEffect, useState } from "react";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { requestRefresh } from "@/lib/hooks/useLiveRefresh";
import styles from "./pullToRefresh.module.css";

const TRIGGER = 64;
const MAX = 88;

export default function PullToRefresh() {
  const { refresh } = useBotHealth();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let startY: number | null = null;
    let distance = 0;
    const start = (e: TouchEvent) => {
      const target = e.target as Element | null;
      startY =
        window.scrollY <= 0 && e.touches.length === 1 && !target?.closest('[role="dialog"], [data-no-pull], input, textarea, select')
          ? e.touches[0].clientY
          : null;
      distance = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      if (window.scrollY > 0) {
        startY = null;
        setPull(0);
        return;
      }
      distance = Math.max(0, (e.touches[0].clientY - startY) * 0.5);
      setPull(Math.min(distance, MAX));
    };
    const end = () => {
      if (startY === null) return;
      startY = null;
      if (distance >= TRIGGER) {
        setBusy(true);
        refresh();
        requestRefresh();
        setTimeout(() => setBusy(false), 900);
      }
      distance = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [refresh]);

  const height = busy ? 40 : pull;
  const label = busy ? "Refreshing…" : pull >= TRIGGER ? "Release to refresh" : pull > 12 ? "Pull to refresh" : "";
  return (
    <div className={styles.strip} style={{ height }} aria-live="polite" aria-hidden={!busy}>
      <span className={busy ? styles.spin : styles.arrow} style={{ transform: busy ? undefined : `rotate(${pull >= TRIGGER ? 180 : 0}deg)` }} aria-hidden>
        {busy ? "" : "↓"}
      </span>
      <span>{label}</span>
    </div>
  );
}
