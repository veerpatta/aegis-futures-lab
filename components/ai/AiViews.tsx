"use client";

/* The AI helper on screen (docs/AI-HELPER.md).

   - AiOpinion: the AI's second opinion on one decision. Owner only: NVIDIA's
     free terms forbid showing AI text to the public. It never changes a trade.
   - AiScoreCard: the public scoreboard, numbers only, computed by our code.
   - AiByline: the label under any AI-written note.

   Honesty rules (docs/design-language.md): too little evidence is amber,
   never red, and no rate is shown without its n. */

import Link from "next/link";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useAi } from "@/components/ai/AiProvider";
import { money } from "@/lib/format";
import {
  AI_OWNER_ONLY, AI_VERDICT_WORDS, aiAgreement, aiCallWords, aiComparison, aiModelName, aiProgress, type AiStudyScore,
} from "@/lib/plain/ai";
import page from "@/components/ui/page.module.css";
import s from "./ai.module.css";

const chipTone = { amber: page.chip_amber, green: page.chip_green, red: page.chip_red } as const;

export function AiByline({ model, kind = "note" }: { model: string; kind?: "note" | "opinion" }) {
  return (
    <p className={s.byline}>
      <span className={s.spark} aria-hidden>✦</span> Written by AI ({aiModelName(model)}) from the bot&apos;s records · {kind === "opinion" ? "being tested, not used for trading" : "not advice"}
    </p>
  );
}

/** The AI's call on one decision, for the owner. Shows nothing to the public. */
export function AiOpinion({ decisionKey, botAction, compact = false }: { decisionKey: string; botAction: "take" | "skip"; compact?: boolean }) {
  const ai = useAi();
  if (ai.ownerStatus !== "ready") return null;
  const call = ai.callFor(decisionKey);
  if (!call) return compact ? null : <p className={page.note}>No AI second opinion on this one: it was decided before the AI study started, or the AI was busy.</p>;
  if (compact)
    return <span className={`${s.mini} ${call.decision === botAction ? s.agree : s.differ}`}>AI: {call.decision === "take" ? "take" : "skip"}</span>;
  return (
    <div className={s.opinion}>
      <div className={s.opinionHead}>
        <b>{aiCallWords(call)}</b>
        <span className={`${page.chip} ${call.decision === botAction ? page.chip_green : page.chip_amber}`}>{aiAgreement(call, botAction)}</span>
      </div>
      <p className={s.reason}>{call.reason}</p>
      <AiByline model={call.model} kind="opinion" />
    </div>
  );
}

/** One study's scoreboard. */
function StudyBoard({ study }: { study: AiStudyScore }) {
  const { mask } = usePrivacy();
  const v = AI_VERDICT_WORDS[study.verdict];
  if (study.status === "waiting-for-model")
    return (
      <div className={s.study}>
        <div className={s.studyHead}>
          <b>{aiModelName(study.model)}</b>
          <span className={`${page.chip} ${page.chip_dim}`}>Waiting</span>
        </div>
        <p className={page.note}>NVIDIA lists this model but has not switched on its API for free keys yet. The helper checks every six hours and starts its own study the moment it answers.</p>
      </div>
    );
  return (
    <div className={s.study}>
      <div className={s.studyHead}>
        <b>{aiModelName(study.model)}</b>
        <span className={`${page.chip} ${chipTone[v.tone]}`}>{v.label}</span>
      </div>
      <p className={page.note}>{aiProgress(study)}. {v.detail}</p>
      {study.resolved > 0 && (
        <dl className={s.compare}>
          {aiComparison(study, (n) => mask(money(n))).map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd className={line.tone === "good" ? page.good : line.tone === "bad" ? page.bad : line.tone === "amber" ? page.warn : page.dim}>
                <b className="num">{line.value}</b>
                {line.note && <small> · {line.note}</small>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The AI helper's scoreboard: what it is, how it is doing, why it is fair. */
export function AiScoreCard() {
  const ai = useAi();
  const studies = ai.scoreboard?.studies ?? [];
  return (
    <section className={page.card} aria-label="AI second opinion">
      <div className={s.cardHead}>
        <h2 className={page.cardTitle}><span className={s.spark} aria-hidden>✦</span> AI second opinion</h2>
        <span className={`${page.chip} ${page.chip_dim}`}>Free · being tested</span>
      </div>
      <p className={s.lede}>
        For every idea the bot decides, a free AI reads the same facts and says whether it would take it. It never changes a trade. Its picks are
        scored against taking every idea and against random picks, after costs, under rules fixed before its first call.
      </p>
      {ai.scoreboard === null ? (
        <p className={page.loading}>Loading the AI scoreboard…</p>
      ) : !ai.scoreboard.available || studies.length === 0 ? (
        <p className={page.empty}>The AI helper is not running yet. It starts with the next scheduled check once it is switched on.</p>
      ) : (
        studies.map((study) => <StudyBoard key={study.id} study={study} />)
      )}
      <p className={page.note}>
        Only a passed check makes the AI eligible to filter trades, and only if you start a new campaign for it. {AI_OWNER_ONLY}{" "}
        <Link href="/guide#ai">How the AI helper works →</Link>
      </p>
    </section>
  );
}
