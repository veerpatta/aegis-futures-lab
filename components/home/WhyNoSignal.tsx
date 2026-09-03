"use client";

/* Item 2.7 — "why no signal today?"

   A quiet system provokes exactly one question: is it broken, or just patient?
   This answers it in one sentence from data the engine already had, so nobody
   has to ask. Reads learned_stats.daily_funnel, which run-live.ts rewrites
   every pass (lib/signals/daily-funnel.ts).

   Deliberately plain: no jargon, no percentages, and every count shown is the
   count the engine actually tallied. If the panel cannot say why, it says that
   rather than guessing. */

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { Badge, DataTable, Panel } from "@/components/ui";
import {
  DAILY_FUNNEL_STAT_KEY,
  summarizeDailyFunnel,
  parseDailyFunnel,
  type DailyFunnelPayload,
} from "@/lib/signals/daily-funnel";
import styles from "./home.module.css";

const STATUS_TONE: Record<DailyFunnelPayload["streams"][number]["status"], "green" | "amber"> = {
  active: "green",
  benched: "amber",
  "stale-data": "amber",
};

const STATUS_TEXT = {
  active: "running",
  benched: "benched",
  "stale-data": "stale feed",
} as const;

const STATUS_DETAIL = {
  active: "Strategy is active and scanning",
  benched: "Benched by circuit breaker after drawdown",
  "stale-data": "Delayed or stale price feed",
} as const;

export default function WhyNoSignal({ dateKey }: { dateKey: string | null }) {
  const [payload, setPayload] = useState<DailyFunnelPayload | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .from("learned_stats")
      .select("payload, date_key")
      .eq("stat_key", DAILY_FUNNEL_STAT_KEY)
      .order("date_key", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.length) return setPayload(null);
        /* Parsed, not cast. A bare `as DailyFunnelPayload` on a half-written
           row made summarizeDailyFunnel throw on Object.values(payload.bars),
           which with no error boundary took the whole dashboard down. */
        setPayload(parseDailyFunnel(data[0].payload));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (payload === undefined)
    return (
      <Panel title="Why no signal today?" hint="the bot's own count of what it looked at">
        <p className={styles.cellSub}>Loading…</p>
      </Panel>
    );

  const summary = summarizeDailyFunnel(payload ?? null, dateKey);
  // A payload from an earlier session is still useful, but say so plainly rather
  // than letting yesterday's count read as today's.
  const isToday = payload !== null && dateKey !== null && payload.dateKey === dateKey;

  return (
    <Panel
      title="Why no signal today?"
      hint="the bot's own count of what it looked at — is it broken, or just patient?"
    >
      <p className={styles.whySentence}>{summary.sentence}</p>

      {payload === null ? (
        <p className={styles.cellSub}>
          The bot has not recorded a check yet. This fills in on its next pass.
        </p>
      ) : (
        <>
          {!isToday && (
            <p className={styles.cellSub}>
              These are the numbers from <b>{payload.dateKey}</b>, the last day the bot ran — not
              today.
            </p>
          )}

          {summary.blockers.length > 0 && (
            <DataTable
              columns={["What stopped a trade", isToday ? "Times today" : "Times that session"]}
              rows={summary.blockers.map((b) => [
                b.label,
                <span key="n" className="num">
                  {b.count.toLocaleString()}
                </span>,
              ])}
              empty="nothing to report"
            />
          )}

          <h3 className={styles.whySubhead}>Each strategy right now</h3>
          <DataTable
            columns={["Stream", "Status", isToday ? "Ideas today" : "Ideas that session"]}
            rows={payload.streams.map((s) => [
              <span key="s">
                {s.tier === "A" ? "Zone setups" : "Daily flow"} · {s.label}
              </span>,
              <span key="b" title={STATUS_DETAIL[s.status]}>
                <Badge tone={STATUS_TONE[s.status]}>
                  {STATUS_TEXT[s.status]}
                </Badge>
              </span>,
              <span key="n" className="num">
                {s.signalsToday}
              </span>,
            ])}
            empty="no streams configured"
          />

          <p className={styles.cellSub}>
            &ldquo;Bars checked&rdquo; is every five-minute candle the bot walked in that session across both
            markets. A high count with nothing qualified is the normal, healthy state — the strategy
            is meant to wait. Paper only, delayed data.
          </p>
        </>
      )}
    </Panel>
  );
}
