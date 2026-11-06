"use client";

/* The learner's ledger (`experiment_trades`), newest first, one page at a time.
   Shared by the Trades list and Today's "Latest trades", so both show the
   same rows in the same words. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getNeon } from "@/lib/neon/client";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import type { ExpTradeRow } from "@/lib/experiment/view";

export type TradeFilter = "all" | "taken" | "skipped" | "open" | "closed" | "earlier";

export const TRADE_COLUMNS =
  "id,decision_key,symbol,side,decided_at,provenance,action,reason,qty,model_version_id,position_status,cancel_reason,exit_reason,exit_ts,net,stale,mode,campaign,execution_clock,observed_at,recorded_at,idea,fill_price,fill_ts,mark,mark_ts,exit_price";

export function useTrades(filter: TradeFilter, pageSize: number) {
  const exp = useExperiment();
  const [rows, setRows] = useState<ExpTradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const request = useRef(0);
  const experimentId = exp.data?.experiment.id ?? null;

  const load = useCallback(
    async (offset: number) => {
      if (!experimentId) return;
      const current = ++request.current;
      setLoading(true);
      try {
        let q = getNeon().from("experiment_trades").select(TRADE_COLUMNS);
        q = filter === "earlier" ? q.eq("lineage", "learner").neq("experiment_id", experimentId) : q.eq("experiment_id", experimentId);
        if (filter === "taken") q = q.eq("action", "take");
        if (filter === "skipped") q = q.eq("action", "skip");
        if (filter === "open") q = q.in("position_status", ["open", "pending_fill"]);
        if (filter === "closed") q = q.eq("position_status", "closed");
        const res = await q.order("decided_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + pageSize - 1);
        if (res.error) throw new Error(res.error.message);
        if (current !== request.current) return;
        const next = (res.data ?? []) as unknown as ExpTradeRow[];
        setRows((prev) => (offset === 0 ? next : [...prev, ...next]));
        setMore(next.length === pageSize);
        setFailed(false);
      } catch {
        if (current === request.current) setFailed(true);
      } finally {
        if (current === request.current) setLoading(false);
      }
    },
    [experimentId, filter, pageSize],
  );

  useEffect(() => {
    void load(0);
    return () => { request.current++; };
  }, [load, exp.loadedAt]);

  const reset = useCallback(() => { request.current++; setRows([]); setLoading(true); }, []);
  return { rows, loading: loading && (!!experimentId || exp.loading), failed: failed || (exp.failed && !exp.data), more, load, reset, experimentId, ready: !!experimentId };
}
