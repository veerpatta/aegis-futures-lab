/* 404. Not an error boundary, but the same gap: without this file a mistyped
   or stale URL fell through to Next's unstyled default page, which looks
   exactly like a crash to someone who does not know the difference.

   Deliberately not a client component — nothing here needs state. */

import Link from "next/link";
import styles from "@/components/ui/error.module.css";

export default function NotFound() {
  return (
    <div className={styles.card} role="alert">
      <h2 className={styles.title}>That page does not exist</h2>
      <p className={styles.body}>
        The link may be out of date, or the page may have been renamed. Nothing has gone wrong with
        the bot or your journal.
      </p>
      <div className={styles.actions}>
        <Link href="/" className={styles.action}>
          Back to the dashboard
        </Link>
        <Link href="/signals" className={styles.action}>
          Today&rsquo;s signals
        </Link>
      </div>
    </div>
  );
}
