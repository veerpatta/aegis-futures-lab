"use client";

/* The More tab: trade ideas and the other records, your own tools, help,
   settings and — last, and labelled — the research room. Groups are found by
   title, never by position, so adding one cannot silently shuffle the page. Settings live here as well as in the header, so a reader who
   never noticed the small header chips can still find them by name. */

import Link from "next/link";
import { useState } from "react";
import { DeskArtwork } from "@/components/widgets/DeskArtwork";
import { WidgetIcon } from "@/components/widgets/WidgetIcon";
import { MORE_GROUPS } from "@/components/nav/links";
import { usePrivacy } from "@/components/providers/PrivacyProvider";
import { useZone } from "@/components/providers/ZoneProvider";
import { DISPLAY_ZONES, ZONE_NAME } from "@/lib/time/zones";
import page from "@/components/ui/page.module.css";
import styles from "./more.module.css";

export default function MoreClient() {
  const { privacy, toggle } = usePrivacy();
  const { zone, setZone } = useZone();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const groups = MORE_GROUPS.map(g => ({ ...g, links: g.links.filter(l => `${g.title} ${l.label} ${l.hint}`.toLowerCase().includes(query)) })).filter(g => g.links.length);
  const research = groups.find((g) => g.title === "Research room");
  const before = groups.filter((g) => g !== research);
  const found = groups.reduce((n, g) => n + g.links.length, 0);

  const group = (g: (typeof MORE_GROUPS)[number]) => (
    <section key={g.title} className={page.stack} aria-label={g.title}>
      <div className={page.sectionHead}>
        <h2>{g.title}</h2>
      </div>
      {g.note && <p className={page.note}>{g.note}</p>}
      <div className={styles.tools}>
        {g.links.map((l) => (
          <Link key={l.href} href={l.href} className={styles.tool}>
            <span className={styles.icon}>{l.icon}</span>
            <span className={page.rowMain} style={{ flex: 1 }}>
              <b>{l.label}</b>
              <span>{l.hint}</span>
            </span>
            <span className={styles.chevron} aria-hidden>
              ↗
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
        <p className={page.paperLine}>Your tools · Virtual only · No real money</p>
      </header>

      <section className={styles.hero} aria-label="Your trading toolkit"><div><span className={styles.kicker}>Explore at your pace</span><h2>Your trading toolkit</h2><p>Find an idea. Keep a journal. Understand every result.</p><span className={styles.deviceNote}><WidgetIcon name="shield" /> Your display settings stay on this device</span></div><DeskArtwork kind="tools" /></section>
      <div className={styles.search}><label htmlFor="tool-search">Find a tool</label><div><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><input id="tool-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Try journal, guide or research" autoComplete="off" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear tool search">×</button>}</div>{query && <p role="status">{found ? `${found} tool${found === 1 ? "" : "s"} found` : "No matching tools. Try a different word."}</p>}</div>
      {before.map(group)}

      {!query && <section className={page.stack} aria-label="Settings">
        <div className={page.sectionHead}>
          <h2>Settings</h2>
        </div>
        <div className={styles.preferences}>
          <div className={styles.preference}>
            <div className={styles.preferenceVisual}><WidgetIcon name="clock" /><strong>{zone}</strong></div>
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
          <div className={styles.preference}>
            <div className={`${styles.preferenceVisual} ${styles.privacyVisual}`}><WidgetIcon name="shield" /><strong>{privacy ? "Hidden" : "Shown"}</strong></div>
            <span className={page.rowMain}>
              <b>Hide money amounts</b>
              <span>Useful when someone can see your screen.</span>
            </span>
            <button type="button" className={styles.privacySwitch} aria-label="Hide money amounts" aria-pressed={privacy} onClick={toggle}>
              <span aria-hidden><i /></span>{privacy ? "Hidden" : "Visible"}
            </button>
          </div>
        </div>
      </section>}

      {research && group(research)}

      <p className={page.note}>Virtual and paper trading on delayed prices. Nothing here touches real money.</p>
    </div>
  );
}
