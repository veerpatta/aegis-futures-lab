"use client";

/* Ideas — every trade idea the live methods posted, followed to its end on
   delayed prices.

   The verdict comes first and stays on screen: both live methods were tested
   on years of data and did no better than chance (lib/strategies/registry.ts
   standingOf), so these are a record of what they did, not advice. Then the
   cards, Open or History. The raw numbers are one tap down, under "For
   researchers", on this same page. */

import { useMemo, useState } from "react";
import type { SignalRow } from "@/lib/neon/client";
import { visibleSignals } from "@/lib/signals/snapshot";
import { isLiveOpen, isStaleOpen } from "@/lib/signals/open-state";
import { standingOf } from "@/lib/strategies/registry";
import { strategyIdForRow } from "@/lib/plain/idea";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { Term } from "@/components/ui/Glossary";
import IdeaCard from "./IdeaCard";
import SignalSheet from "./SignalSheet";
import ResearchDrawer from "./ResearchDrawer";
import { useConditionLedger } from "./useConditionLedger";
import { useNowSec, useSignalFeed } from "./useSignalFeed";
import page from "@/components/ui/page.module.css";

type Segment = "open" | "history";
const HISTORY_PAGE = 15;

export default function IdeasClient() {
  const nowSec = useNowSec();
  const feed = useSignalFeed();
  const health = useBotHealth();
  const ledger = useConditionLedger();
  /* Until the reader picks, show Open when something is open and History otherwise. */
  const [chosen, setSegment] = useState<Segment | null>(null);
  const [shown, setShown] = useState(HISTORY_PAGE);
  const [sheet, setSheet] = useState<SignalRow | null>(null);

  const visible = useMemo(() => visibleSignals(feed.rows), [feed.rows]);
  const openRows = useMemo(
    () => (nowSec === null ? [] : visible.filter((s) => isLiveOpen(s, nowSec))),
    [visible, nowSec]
  );
  /* History: closed ideas plus any the engine has not resolved yet, newest first. */
  const historyRows = useMemo(
    () => visible.filter((s) => s.pnl_usd !== null || (nowSec !== null && isStaleOpen(s, nowSec))),
    [visible, nowSec]
  );

  const verdict = useMemo(() => {
    const ids = [...new Set(feed.rows.map(strategyIdForRow).filter(Boolean))];
    const refuted = ids.filter((id) => standingOf(id) === "refuted").length;
    return { methods: ids.length, refuted };
  }, [feed.rows]);

  const segment: Segment = chosen ?? (openRows.length ? "open" : "history");
  const rows = segment === "open" ? openRows : historyRows.slice(0, shown);

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">Ideas</h1>
        <p className={page.lede}>
          Buy and sell setups the methods spotted, each followed to its end on delayed prices. This research record
          stays separate from the <Term k="experimentalLearner">virtual account</Term>.
        </p>
        <p className={page.paperLine}>Practice only · Delayed prices · No real money</p>
      </header>

      {verdict.refuted > 0 && (
        <p className={page.verdict}>
          {verdict.refuted === verdict.methods
            ? `${verdict.methods === 1 ? "The method posting these ideas was" : verdict.methods === 2 ? "Both methods posting these ideas were" : `All ${verdict.methods} methods posting these ideas were`} tested on years of past prices and `
            : `${verdict.refuted} of the ${verdict.methods} methods posting these ideas were tested and `}
          <b>
            <Term k="refuted">did no better than chance</Term>
          </b>
          . Read them as a record of what the methods do, not as advice.
        </p>
      )}

      <div className={page.segment} role="group" aria-label="Which ideas">
        <button
          type="button"
          className={segment === "open" ? `${page.seg} ${page.segOn}` : page.seg}
          aria-pressed={segment === "open"}
          onClick={() => setSegment("open")}
        >
          Open · {openRows.length}
        </button>
        <button
          type="button"
          className={segment === "history" ? `${page.seg} ${page.segOn}` : page.seg}
          aria-pressed={segment === "history"}
          onClick={() => setSegment("history")}
        >
          History
        </button>
      </div>

      {feed.failed && (
        <p className={page.warning}>
          Ideas could not refresh. {feed.rows.length ? "Showing the previous update." : ""}{" "}
          <button type="button" onClick={feed.refresh}>
            Try again
          </button>
        </p>
      )}

      <section className={page.stack} aria-label="Trade ideas">
        {feed.loading ? (
          <p className={page.loading}>Loading trade ideas…</p>
        ) : rows.length === 0 ? (
          <p className={page.empty}>
            {segment === "open"
              ? "Nothing open right now. New ideas only start between 02:00 and 15:25 New York time, and quiet days are normal."
              : "No closed ideas yet."}
          </p>
        ) : (
          rows.map((s) => <IdeaCard key={s.id} signal={s} nowSec={nowSec} onOpen={setSheet} />)
        )}
        {segment === "history" && historyRows.length > shown && (
          <button type="button" className={page.linkButton} onClick={() => setShown((n) => n + HISTORY_PAGE)}>
            Show older ideas
          </button>
        )}
      </section>

      <details className={page.details}>
        <summary>For researchers — every number behind these cards</summary>
        {!feed.loading && <ResearchDrawer rows={feed.rows} orphaned={feed.orphaned} runs={health.runs} policy={health.policy} />}
      </details>

      <SignalSheet signal={sheet} ledger={ledger} onClose={() => setSheet(null)} />
    </div>
  );
}
