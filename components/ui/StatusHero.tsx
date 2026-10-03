"use client";

/* The one-sentence answer at the top of Today and Bot: is the bot working,
   and is it trading practice money?

   Two separate facts, never blended: the badge is the practice account's
   state (botState in lib/paper/overview.ts) and the health line is whether
   the price checks are running (BotHealthProvider). A healthy engine with no
   qualified method is the normal state today, and the sentence says so plainly
   rather than letting a green dot imply the bot is making money. */

import { usePaper } from "@/components/providers/PaperProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { botState } from "@/lib/paper/overview";
import { botSentence, healthLook } from "@/lib/plain/bot";
import { ago } from "@/lib/time/session";
import styles from "./plain.module.css";

export default function StatusHero({ action }: { action?: React.ReactNode }) {
  const paper = usePaper();
  const health = useBotHealth();
  const failed = paper.errors.includes("Account");
  const state = botState(paper.data, failed);
  const look = healthLook(health);
  const sentence = paper.loading ? "Checking the bot and the practice account…" : botSentence(state.label, paper.data);
  const tone = paper.loading ? "dim" : state.tone;

  return (
    <section className={`${styles.hero} ${styles[`hero_${tone}`] ?? ""}`} aria-label="Bot status">
      <div className={styles.heroTop}>
        <span className={`${styles.heroBadge} ${styles[`badge_${tone}`] ?? ""}`}>
          {paper.loading ? "Checking…" : state.label}
        </span>
        <span className={styles.health} title={look.detail}>
          <i className={`${styles.dot} ${styles[`dot_${look.tone}`]}`} aria-hidden />
          {look.label}
          {health.lastRun && !health.loading && (
            <span className={styles.healthAge}> · {ago(health.lastRun.ran_at)}</span>
          )}
        </span>
      </div>
      <p className={styles.heroText}>{sentence}</p>
      {action && <div className={styles.heroAction}>{action}</div>}
    </section>
  );
}
