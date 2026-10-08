"use client";

/* The More tab: trade ideas and the other records, your own tools, help,
   settings and — last, and labelled — the research room. Groups are found by
   title, never by position, so adding one cannot silently shuffle the page. Settings live here as well as in the header, so a reader who
   never noticed the small header chips can still find them by name. */

import Link from "next/link";
import { MORE_GROUPS } from "@/components/nav/links";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { DISPLAY_ZONES, ZONE_NAME } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";

export default function MoreClient() {
  const { privacy, toggle } = usePrivacy();
  const { zone, setZone } = useZone();
  const research = MORE_GROUPS.find((g) => g.title === "Research room");
  const before = MORE_GROUPS.filter((g) => g !== research);

  const group = (g: (typeof MORE_GROUPS)[number]) => (
    <section key={g.title} className={page.stack} aria-label={g.title}>
      <div className={page.sectionHead}>
        <h2>{g.title}</h2>
      </div>
      {g.note && <p className={page.note}>{g.note}</p>}
      <div className={page.list}>
        {g.links.map((l) => (
          <Link key={l.href} href={l.href} className={page.row}>
            <span className={page.rowIcon}>{l.icon}</span>
            <span className={page.rowMain} style={{ flex: 1 }}>
              <b>{l.label}</b>
              <span>{l.hint}</span>
            </span>
            <span className={page.chev} aria-hidden>
              ›
            </span>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className={page.page}>
      <header className={page.head}>
        <h1 className="pageTitle">More</h1>
        <p className={page.lede}>Trade ideas, method research, your journal, help and settings.</p>
      </header>

      {before.map(group)}

      <section className={page.stack} aria-label="Settings">
        <div className={page.sectionHead}>
          <h2>Settings</h2>
        </div>
        <div className={page.list}>
          <div className={page.setting}>
            <span className={page.rowMain}>
              <b>Show times in</b>
              <span>{ZONE_NAME[zone]}. Trading days still follow New York.</span>
            </span>
            <span style={{ display: "flex", gap: 6 }} role="group" aria-label="Show times in">
              {DISPLAY_ZONES.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={page.switch}
                  aria-pressed={z === zone}
                  onClick={() => setZone(z)}
                >
                  {z}
                </button>
              ))}
            </span>
          </div>
          <div className={page.setting}>
            <span className={page.rowMain}>
              <b>Hide money amounts</b>
              <span>Useful when someone can see your screen.</span>
            </span>
            <button type="button" className={page.switch} aria-pressed={privacy} onClick={toggle}>
              {privacy ? "On" : "Off"}
            </button>
          </div>
        </div>
      </section>

      {research && group(research)}

      <p className={page.note}>Virtual and paper trading on delayed prices. Nothing here touches real money.</p>
    </div>
  );
}
