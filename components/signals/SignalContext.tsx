"use client";

/* Item 2.8 — the context strip under a signal card.

   Shows, without a click: what the setup is, what invalidates it, how this KIND
   of setup has done (the matching condition-ledger cell), and the model's win
   probability. Shared by Home's recent ideas and the Signals blotter so the two
   can never tell different stories about the same row.

   Hard rule: a historical cell never appears without its sample count, and is
   labelled "still collecting" below the minimum. There is no code path here that
   renders a bare percentage. */

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import {
  describeCell,
  describeInvalidation,
  describeSetup,
  describeWinProb,
  historicalCells,
  type ConditionLedger,
  type SignalLike,
} from "@/lib/signals/context";
import styles from "./signals.module.css";

/* One shared fetch of the nightly ledger for every card on the page. Module
   scope, so N cards do not make N requests. */
let ledgerPromise: Promise<ConditionLedger | null> | null = null;
function loadLedger(): Promise<ConditionLedger | null> {
  ledgerPromise ??= Promise.resolve(
    getSupabase()
      .from("learned_stats")
      .select("payload")
      .eq("stat_key", "condition_ledger")
      .order("date_key", { ascending: false })
      .limit(1)
  ).then(({ data, error }) =>
    error || !data?.length ? null : (data[0].payload as ConditionLedger)
  );
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

export default function SignalContext({
  signal,
  ledger,
}: {
  signal: SignalLike;
  ledger: ConditionLedger | null;
}) {
  const cells = historicalCells(ledger, signal);

  return (
    <div className={styles.ctx}>
      <div className={styles.ctxLine}>
        <span className={styles.ctxKey}>Setup</span>
        <span>{describeSetup(signal)}</span>
      </div>
      <div className={styles.ctxLine}>
        <span className={styles.ctxKey}>Invalidated</span>
        <span>{describeInvalidation(signal)}</span>
      </div>
      <div className={styles.ctxLine}>
        <span className={styles.ctxKey}>Odds</span>
        <span>
          {describeWinProb(signal)}
          {signal.score !== null && <> · zone score {signal.score}</>}
        </span>
      </div>
      <div className={styles.ctxLine}>
        <span className={styles.ctxKey}>History</span>
        <span>
          {cells.length === 0 ? (
            ledger === null
              ? "the nightly knowledge tables have not been built yet"
              : "no history for this combination of tier and conditions yet"
          ) : (
            <>
              {cells.map((h) => (
                <span
                  key={h.label}
                  className={h.insufficient ? styles.ctxCollecting : undefined}
                  style={{ display: "block" }}
                >
                  {describeCell(h)}
                </span>
              ))}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
