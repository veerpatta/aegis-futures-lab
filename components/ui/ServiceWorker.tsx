"use client";

/* Registers public/sw.js in production builds only — a worker in `next dev`
   would cache development chunks and make every edit look like it did nothing.

   A new version never takes over on its own mid-visit: when one is waiting,
   a small "Update ready" bar appears and the reader chooses when to reload,
   so nothing they are reading or typing is interrupted. */

import { useEffect, useRef, useState } from "react";
import styles from "./ui.module.css";

export default function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // Reload only after the reader asked for the update — a first-ever worker
  // also claims the page (controllerchange) and must not reload it.
  const requested = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    const onController = () => {
      if (reloading || !requested.current) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
          });
        });
        // Check for a new version when the app comes back to the front.
        const check = () => document.visibilityState === "visible" && reg.update().catch(() => undefined);
        document.addEventListener("visibilitychange", check);
      })
      .catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);

  if (!waiting) return null;
  return (
    <div className={styles.updateBar} role="status">
      <span>A new version of Aegis is ready.</span>
      <button
        type="button"
        onClick={() => {
          requested.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Update now
      </button>
      <button type="button" onClick={() => setWaiting(null)} aria-label="Later">
        Later
      </button>
    </div>
  );
}
