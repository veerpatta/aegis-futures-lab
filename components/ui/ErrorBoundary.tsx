"use client";

/* Fault containment.

   Before this existed there were no error boundaries anywhere in the app —
   no app/error.tsx, no global-error.tsx — and every page is a "use client"
   shell that fetches its own data. So a single throw in one panel unmounted
   the whole tree and Next rendered its bare "Application error: a client-side
   exception has occurred". One malformed jsonb row on one card read to the
   user as "the entire app is broken", which is most of what "everything is
   broken" turned out to mean.

   Two pieces here:

   `ErrorCard` is the shared presentation, used by the route-level boundaries
   in app/. `SectionBoundary` is the class component, because Next's error.tsx
   convention only catches at route level and the point is to lose one panel
   rather than the page.

   Writing style follows the manual's: plain trading language, short sentences,
   and the money warning stays visible — a trader looking at a broken screen
   should not have to wonder whether a position is involved. */

import React from "react";
import styles from "./error.module.css";

/* Next attaches a `digest` to errors thrown during server rendering; it is the
   only handle a user can quote back, since the real message is stripped in
   production. */
export interface AppError extends Error {
  digest?: string;
}

export function ErrorCard({
  title = "This page hit an error",
  error,
  reset,
}: {
  title?: string;
  error?: AppError;
  reset?: () => void;
}) {
  return (
    <div className={styles.card} role="alert">
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>
        Something on this screen failed to load. This is a fault in the app, not a signal and not a
        trade.
      </p>
      <p className={styles.safe}>
        Nothing here touches real money, and no order was placed. Your journal is stored on this
        device and is untouched.
      </p>
      <div className={styles.actions}>
        {reset && (
          <button type="button" onClick={reset} className={styles.action}>
            Try again
          </button>
        )}
        <a href="/" className={styles.action}>
          Back to the dashboard
        </a>
      </div>
      {error?.digest && <p className={styles.ref}>Reference: {error.digest}</p>}
    </div>
  );
}

interface BoundaryProps {
  /* Named so the fallback can say WHICH card died. "Zones to watch could not
     load" is a different message from "the page broke", and the whole point of
     a section boundary is that the user can tell them apart. */
  label: string;
  children: React.ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class SectionBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    /* Logged rather than swallowed. A boundary that hides the stack turns a
       reproducible bug into "it sometimes shows the amber box". */
    console.error(`[${this.props.label}] section failed:`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.inline} role="alert">
        <p className={styles.inlineTitle}>{this.props.label} could not load</p>
        <p className={styles.inlineBody}>
          The rest of the page is fine. This section hit an error and has been left out rather than
          shown with numbers that might be wrong.
        </p>
      </div>
    );
  }
}
