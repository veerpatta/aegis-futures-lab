/* Shown by the service worker (public/sw.js) when a page is opened with no
   connection and was never opened before. Static on purpose: it must work
   with nothing but the cached shell. */

import Link from "next/link";
import styles from "@/components/ui/error.module.css";

export const metadata = { title: "Offline · Aegis" };

export default function Offline() {
  return (
    <div className={styles.card} role="status">
      <h2 className={styles.title}>You&rsquo;re offline</h2>
      <p className={styles.body}>
        Aegis needs a connection for new prices, trade ideas and the bot&rsquo;s accounts. Screens you opened
        earlier still show their last update, with the time it was taken. Nothing here touches real money.
      </p>
      <div className={styles.actions}>
        <Link href="/" className={styles.action}>
          Try again
        </Link>
      </div>
    </div>
  );
}
