"use client";

/* Privacy mode — the eye button in the app header. Masks every money figure on
   screen so the app can be opened on a train without showing a P&L to the seat
   next door. It hides nothing else: prices, times, win rates, sample counts and
   status labels all stay, because those are what make the screen readable.

   Remembered per device, like the ET/IST switch. Off on the server and on first
   paint so the markup hydrates identically; the stored choice lands after
   mount. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "aegis.privacy.v1";
const MASK = "••••";

interface PrivacyContextValue {
  privacy: boolean;
  toggle: () => void;
  /** Mask an already-formatted money string. */
  mask: (v: string) => string;
  /** Format-and-mask in one step, for the common `money()` call site. */
  maskMoney: (v: number, fmt: (n: number) => string) => string;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  privacy: false,
  toggle: () => {},
  mask: (v) => v,
  maskMoney: (v, fmt) => fmt(v),
});

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [privacy, setPrivacy] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setPrivacy(true);
    } catch {
      /* private mode — stay off */
    }
  }, []);

  const toggle = useCallback(() => {
    setPrivacy((p) => {
      const next = !p;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<PrivacyContextValue>(
    () => ({
      privacy,
      toggle,
      mask: (v) => (privacy ? MASK : v),
      maskMoney: (v, fmt) => (privacy ? MASK : fmt(v)),
    }),
    [privacy, toggle]
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
