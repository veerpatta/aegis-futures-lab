"use client";

/* One refresh rhythm for every provider.

   - every `intervalMs` while the page is visible (a phone in a pocket stops
     polling, which saves data and battery);
   - at once when the app comes back to the front, regains focus or comes back
     online, if the last refresh is more than 10 seconds old;
   - whenever pull-to-refresh (or anything else) calls requestRefresh().

   An installed app has no browser reload button, so these are how a phone
   user gets fresh numbers. */

import { useEffect, useRef } from "react";

export const REFRESH_EVENT = "aegis:refresh";
const WAKE_AFTER_MS = 10_000;

export function requestRefresh(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function useLiveRefresh(refresh: () => void, intervalMs = 60_000): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      ref.current();
    };
    const visible = () => document.visibilityState === "visible";
    const tick = setInterval(() => {
      if (visible()) run();
    }, intervalMs);
    const wake = () => {
      if (visible() && Date.now() - last > WAKE_AFTER_MS) run();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener(REFRESH_EVENT, run);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener(REFRESH_EVENT, run);
    };
  }, [intervalMs]);
}

/* Last good data per screen, kept for the session so a reload or a return to
   the app paints at once instead of flashing "Loading…". Storage can be
   blocked (private mode, quota) — every access is wrapped and optional. */
export function readCache<T>(key: string, maxAgeMs = 6 * 3600_000): { at: number; value: T } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    return Number.isFinite(parsed.at) && Date.now() - parsed.at < maxAgeMs ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* storage full or blocked — the next load simply starts empty */
  }
}
