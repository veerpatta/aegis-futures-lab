"use client";

import Link from "next/link";
import { useExperiment } from "@/components/providers/ExperimentProvider";
import { useBotHealth } from "@/components/providers/BotHealthProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { botActivity } from "@/lib/plain/companion";
import { quietReasons, timerStatus } from "@/lib/plain/timer";
import { nextTickSec } from "@/lib/experiment/view";
import { clockIn, ZONE_ABBR } from "@/lib/time/zones";
import { WidgetIcon } from "./WidgetIcon";
import { DeskArtwork } from "./DeskArtwork";
import s from "./desk.module.css";

export function TodayPulse({ now }: { now: number | null }) {
  const exp = useExperiment();
  const health = useBotHealth();
  const { zone } = useZone();
  const activity = botActivity(exp.data, now, exp.online, exp.failed);
  const next = now ? nextTickSec(now) : null;
  const attention = ["attention", "offline", "loading", "resting"].includes(activity.mood);
  // Is the bot on time, and if not, why and what fixes it (docs/ENGINE-CLOCK.md).
  const timer = now !== null && !health.loading && exp.online
    ? timerStatus({ lastRunAt: health.lastRun?.ran_at ?? null, clock: health.clock, nowSec: now, asleep: health.asleep })
    : null;
  // Why no trade lately — only from saved decisions and the loss guards.
  const openNow = exp.data ? exp.data.open_positions.filter(p => p.status === "open").length : 0;
  const quiet = now !== null && exp.data && !openNow && !(exp.data.today?.closed) ? quietReasons(exp.data, health.policy, now) : [];
  return <section className={`${s.pulse} ${attention ? s.quiet : ""}`} aria-label="Today at a glance">
    <div className={s.pulseMain}><div><span className={s.eyebrow}>Your day at a glance</span><h2>{activity.title}</h2><p>{attention ? activity.detail : "Your virtual account keeps its own record. Check trades, then see what the bot learned."}</p></div><DeskArtwork kind="radar" /></div>
    {timer && <div className={`${s.timer} ${s[`timer_${timer.tone}`]}`} role="status">
      <WidgetIcon name="clock" />
      <div><b>Timer · {timer.title}</b><span>{timer.detail}</span>{timer.fix && <Link href="/guide#timer">How to fix it →</Link>}</div>
    </div>}
    {quiet.length > 0 && <>
      <span className={s.whyTitle}>Why it has been quiet</span>
      <ul className={s.why}>{quiet.map(line => <li key={line}>{line}</li>)}</ul>
    </>}
    <div className={s.quickGrid}>
      <Link href="/trades"><WidgetIcon name="check" /><b>{exp.data?.today?.closed ?? "—"}</b><span>Closed today</span></Link>
      <Link href="/trades?view=open"><WidgetIcon name="activity" /><b>{exp.data ? openNow : "—"}</b><span>Open trades</span></Link>
      <Link href="/brain"><WidgetIcon name="clock" /><b>{next ? clockIn(next, zone) : "—"}</b><span>Next check · {ZONE_ABBR[zone]}</span></Link>
    </div>
    <span className={s.caption}>{exp.online ? "Expected check time · open the bot for its recorded activity" : "Offline · saved figures"}</span>
  </section>;
}
