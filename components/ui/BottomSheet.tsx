"use client";

/* The spring-up sheet the native pass uses instead of a detail page. Any idea —
   from Home's live card, Home's recent list, the Signals blotter or a Journal
   day — opens here, so you never lose your scroll position.

   Behaviour the design implies and a web app has to add for itself: Escape
   closes it, the scrim closes it, focus moves into the sheet when it opens and
   returns to the trigger when it closes, and the page behind it stops
   scrolling. Below 768px it is a bottom sheet; above, it settles into a
   centred dialog, because a full-width slab pinned to the bottom of a 1440px
   window is a phone gesture pretending to be a desktop one. */

import { useCallback, useEffect, useId, useRef } from "react";
import styles from "./sheet.module.css";

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name — usually the symbol and side, e.g. "BUY MES". */
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const labelId = useId();

  /* Remember what opened us, and hand focus back on close. */
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    return () => {
      restoreTo.current?.focus?.();
    };
  }, [open]);

  /* Escape closes; the body behind stops scrolling while we are up. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  /* Keep Tab inside the sheet while it is open. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div className={styles.layer} data-open={open || undefined} aria-hidden={!open}>
      <div className={styles.scrim} onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <span className={styles.grabber} aria-hidden />
        <span id={labelId} className={styles.srOnly}>
          {title}
        </span>
        {children}
      </div>
    </div>
  );
}

/** The ✕ in a sheet header. */
export function SheetClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className={`${styles.close} press`} onClick={onClose} aria-label="Close">
      ✕
    </button>
  );
}
