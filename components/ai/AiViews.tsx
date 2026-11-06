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
import { useZone } from "@/components/providers/ZoneProvider";
import { useAi } from "@/components/ai/AiProvider";
import { money } from "@/lib/format";
import { dateShortIn } from "@/lib/time/zones";
import {
  AI_OWNER_ONLY, AI_VERDICT_WORDS, IDEA_VERDICT_WORDS, aiAgreement, aiCallWords, aiComparison, aiModelName, aiProgress, ideaProgress, ideaRuleWords, waitingStudyWords, waitingWords,
  type AiStudyScore,
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
        <p className={page.note}>{waitingStudyWords(study, Date.now())}</p>
      </div>
    );
  return (
    <div className={s.study}>
      <div className={s.studyHead}>
        <b>{aiModelName(study.model)}</b>
        <span className={`${page.chip} ${chipTone[v.tone]}`}>{v.label}</span>
      </div>
      <p className={page.note}>{aiProgress(study)}. {v.detail}</p>
      {waitingWords(study.waiting) && <p className={page.note}>{waitingWords(study.waiting)}</p>}
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
      <OwnerHint />
    </section>
  );
}

/** For anyone who is not (yet) the signed-in owner: where the AI's words are. */
function OwnerHint() {
  const ai = useAi();
  if (ai.ownerStatus === "ready") return null;
  return (
    <p className={s.hint}>
      <span className={s.spark} aria-hidden>✦</span>{" "}
      {ai.ownerStatus === "not-owner"
        ? "This account is not the owner's, so the AI's reasons stay hidden."
        : <>Owner? <Link href="/brain#ai-research">Sign in under Ask the AI</Link> to read the AI&apos;s reasons, notes and rules.</>}
    </p>
  );
}

/** The AI's research ideas: simple skip rules, each tested only on later trades. */
export function AiIdeasCard() {
  const ai = useAi();
  const { mask } = usePrivacy();
  const { zone } = useZone();
  const scores = ai.scoreboard?.ideas ?? [];
  const owner = ai.ownerStatus === "ready";
  const week = owner ? [...ai.notes].filter((n) => n.kind === "week").sort((a, b) => b.subject.localeCompare(a.subject))[0] ?? null : null;
  return (
    <section className={page.card} aria-label="AI research ideas">
      <div className={s.cardHead}>
        <h2 className={page.cardTitle}><span className={s.spark} aria-hidden>✦</span> Ideas the AI is testing</h2>
        <span className={`${page.chip} ${page.chip_dim}`}>Up to 3 at a time</span>
      </div>
      <p className={s.lede}>
        Each week the AI studies the bot&apos;s finished trades and suggests simple rules for ideas to skip. Each rule is tested only on trades that
        come after it, against taking every idea and against random skips, after costs. Only a rule that passes can be added to a future campaign.
      </p>
      {week && (
        <div className={s.week}>
          <b>This week the AI noticed</b>
          <p className={s.reason}>{week.text}</p>
          <AiByline model={week.model} />
        </div>
      )}
      {ai.scoreboard === null ? (
        <p className={page.loading}>Loading the AI&apos;s ideas…</p>
      ) : scores.length === 0 ? (
        <p className={page.empty}>No rules yet. The AI suggests its first ones once the bot has 20 finished trades, then looks again every week.</p>
      ) : (
        <ol className={s.ideas}>
          {scores.map((score, i) => {
            const text = owner ? ai.ideas.find((idea) => idea.id === score.id) ?? null : null;
            const v = IDEA_VERDICT_WORDS[score.verdict];
            const proposed = Date.parse(score.proposedAt);
            return (
              <li key={score.id} className={s.study}>
                <div className={s.studyHead}>
                  <b>{text ? text.name : `Rule ${i + 1}`}</b>
                  <span className={`${page.chip} ${chipTone[v.tone]}`}>{score.status === "retired" && score.verdict !== "pass" && score.verdict !== "fail" ? "Finished" : v.label}</span>
                </div>
                {text && <p className={s.rule}>{ideaRuleWords(text)}</p>}
                {text && <p className={page.note}>Why: {text.why}</p>}
                <p className={page.note}>
                  Proposed {Number.isFinite(proposed) ? dateShortIn(proposed / 1000, zone) : "—"} by {aiModelName(score.model)} · {ideaProgress(score)}. {v.detail}
                </p>
                {waitingWords(score.waiting) && <p className={page.note}>{waitingWords(score.waiting)}</p>}
                {score.resolved > 0 && (
                  <dl className={s.compare}>
                    <div>
                      <dt>Trades it would keep</dt>
                      <dd className={score.verdict === "too-early" ? page.warn : score.keptNet > 0 ? page.good : score.keptNet < 0 ? page.bad : page.dim}>
                        <b className="num">{mask(money(score.keptNet))}</b><small> · n={score.resolved - score.skipped}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Taking every idea</dt>
                      <dd className={score.verdict === "too-early" ? page.warn : score.takeAllNet > 0 ? page.good : score.takeAllNet < 0 ? page.bad : page.dim}>
                        <b className="num">{mask(money(score.takeAllNet))}</b><small> · n={score.resolved}</small>
                      </dd>
                    </div>
                    {score.randomPercentile !== null && (
                      <div>
                        <dt>Random skips of the same size</dt>
                        <dd className={score.verdict === "too-early" ? page.warn : page.dim}>
                          <b className="num">beat {Math.round(score.randomPercentile)}% of them</b><small> · n={score.skipped}</small>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <OwnerHint />
    </section>
  );
}
