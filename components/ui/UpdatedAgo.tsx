"use client";

/* "Updated 2 min ago" — how fresh the numbers on a screen are. Rendered only
   after mount (the time is the phone's, not the server's), and says when a
   refresh failed so an old read never passes for a new one. */

import { useNowSec } from "@/components/signals/useSignalFeed";
import page from "./page.module.css";

export function agoWords(ms: number, nowMs: number): string {
  const min = Math.floor((nowMs - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export default function UpdatedAgo({ at, failed = false }: { at: number | null; failed?: boolean }) {
  const nowSec = useNowSec(30_000);
  if (nowSec === null || at === null) return null;
  return (
    <p className={page.updated} aria-live="polite">
      {failed ? "Couldn't refresh · showing the update from " : "Updated "}
      {agoWords(at, Math.max(nowSec * 1000, at))}
      <span className={page.touchOnly}> · pull down to refresh</span>
    </p>
  );
}
