import Link from "next/link";
import {SECONDARY_LINKS} from "@/components/nav/links";
import styles from "@/components/home/simple-workspace.module.css";
export default function MorePage(){return <div className={styles.page}><h1 className="pageTitle">More</h1><p className={styles.caption}>Your journal, help and research tools.</p><div className={styles.list}>{SECONDARY_LINKS.map(l=><Link key={l.href} href={l.href}><div><b>{l.label}</b><span>{l.hint}</span></div><span aria-hidden>→</span></Link>)}<Link href="/research-history"><div><b>Legacy signal research</b><span>Original signal results and comparisons</span></div><span aria-hidden>→</span></Link></div></div>;}
