"use client";

/* The nightly condition ledger (learned_stats `condition_ledger`) for every
   idea on a page — how this KIND of setup has done in conditions like these.
   One shared fetch at module scope, so N cards never make N requests.

   Moved out of the old SignalContext strip, which only the removed legacy
   dashboard still rendered. */

import { useEffect, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import type { ConditionLedger } from "@/lib/signals/context";

let ledgerPromise: Promise<ConditionLedger | null> | null = null;

function loadLedger(): Promise<ConditionLedger | null> {
  ledgerPromise ??= Promise.resolve(
    getNeon()
      .from("learned_stats")
      .select("payload")
      .eq("stat_key", "condition_ledger")
      .order("date_key", { ascending: false })
      .limit(1)
  ).then(({ data, error }) => (error || !data?.length ? null : (data[0].payload as ConditionLedger)));
  return ledgerPromise;
}

export function useConditionLedger(): ConditionLedger | null {
  const [ledger, setLedger] = useState<ConditionLedger | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLedger().then((l) => {
      if (!cancelled) setLedger(l);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ledger;
}
