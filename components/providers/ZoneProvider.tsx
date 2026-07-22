"use client";

/* Which clock the app shows times on — New York exchange time or India time.
   One choice, applied everywhere, remembered on the device. It changes nothing
   about the data: signals are still grouped by New York trading day and the
   journal is still typed in ET wall clock, because that is what the chart and
   the strategy rules are anchored to. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DisplayZone } from "@/lib/time/zones";

const STORAGE_KEY = "aegis.displayZone.v1";

interface ZoneContextValue {
  zone: DisplayZone;
  setZone: (zone: DisplayZone) => void;
}

const ZoneContext = createContext<ZoneContextValue>({ zone: "ET", setZone: () => {} });

export function ZoneProvider({ children }: { children: React.ReactNode }) {
  /* ET on the server and on first paint; the stored/derived choice lands after
     mount so the markup hydrates identically everywhere. */
  const [zone, setZoneState] = useState<DisplayZone>("ET");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "ET" || saved === "IST") {
        setZoneState(saved);
        return;
      }
      // No choice made yet: default to IST for a device already set to India.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") setZoneState("IST");
    } catch {
      /* private mode — keep the ET default */
    }
  }, []);

  const setZone = useCallback((next: DisplayZone) => {
    setZoneState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ zone, setZone }), [zone, setZone]);
  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
}

/** The zone every time on screen is rendered in. */
export function useZone(): ZoneContextValue {
  return useContext(ZoneContext);
}
