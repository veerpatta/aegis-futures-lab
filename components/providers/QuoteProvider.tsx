"use client";

/* The two delayed quotes, shared: Today's market card, the running result of
   open ideas and open trial trades all read the same price, fetched once a
   minute through the light `?view=quote` read instead of five days of bars. */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchQuote, type MarketPayload } from "@/lib/data/fetch";
import { useLiveRefresh } from "@/lib/hooks/useLiveRefresh";

type Quotes = Partial<Record<"MES" | "MNQ", MarketPayload>>;
const Context = createContext<Quotes>({});

export function QuoteProvider({ children }: { children: React.ReactNode }) {
  const [quotes, setQuotes] = useState<Quotes>({});
  const load = useCallback(() => {
    for (const symbol of ["MES", "MNQ"] as const)
      fetchQuote(symbol)
        .then((q) => setQuotes((prev) => ({ ...prev, [symbol]: q })))
        .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(load);
  return <Context.Provider value={quotes}>{children}</Context.Provider>;
}

export const useQuotes = () => useContext(Context);
