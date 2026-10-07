"use client";

/* Registers public/sw.js in production builds only — a worker in `next dev`
   would cache development chunks and make every edit look like it did nothing. */

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
