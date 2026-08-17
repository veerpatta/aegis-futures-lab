"use client";

/* The last resort: a throw in the root layout itself, or in one of the four
   providers it wraps everything in (ZoneProvider, DataProvider,
   PrivacyProvider, BotHealthProvider). app/error.tsx renders INSIDE the
   layout, so it cannot catch those.

   This replaces the layout entirely, which is why it ships its own <html> and
   <body> and why the card's styling falls back to literal colours — none of
   the app's chrome is guaranteed to be present here. */

import { useEffect } from "react";
import { ErrorCard, type AppError } from "@/components/ui/ErrorBoundary";
import styles from "@/components/ui/error.module.css";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: AppError; reset: () => void }) {
  useEffect(() => {
    console.error("global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className={styles.page}>
          <div className={styles.pageInner}>
            <ErrorCard title="Aegis could not start" error={error} reset={reset} />
          </div>
        </div>
      </body>
    </html>
  );
}
