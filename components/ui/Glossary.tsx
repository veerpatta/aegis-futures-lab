"use client";

/* Tap a word, get its plain meaning.

   Native `title=` tooltips were the only explanation layer before, and they do
   nothing on a phone. A <Term> is a real button: tap it and one shared bottom
   sheet (one per app, not one per word) opens with the definition from
   lib/glossary.ts. The sheet stays mounted and aria-hidden while closed, like
   every other sheet, so pages never gain an extra visible dialog. */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import BottomSheet, { SheetClose } from "./BottomSheet";
import styles from "./plain.module.css";

const GlossaryContext = createContext<(key: GlossaryKey) => void>(() => {});

export function GlossaryProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<GlossaryKey | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const show = useCallback((key: GlossaryKey) => setOpen(key), []);
  const entry = open ? GLOSSARY[open] : null;
  return (
    <GlossaryContext.Provider value={show}>
      {children}
      <BottomSheet open={open !== null} onClose={close} title={entry ? `What “${entry.term}” means` : "Word meaning"}>
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle}>{entry?.term ?? ""}</h2>
          <SheetClose onClose={close} />
        </div>
        <p className={styles.sheetBody}>{entry?.meaning ?? ""}</p>
        <Link href="/guide#words" className={styles.sheetLink} onClick={close}>
          All words in the Guide →
        </Link>
      </BottomSheet>
    </GlossaryContext.Provider>
  );
}

export function useGlossary() {
  return useContext(GlossaryContext);
}

/** A word with a plain meaning one tap away. Children default to the glossary term. */
export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const show = useGlossary();
  const label = useMemo(() => GLOSSARY[k].term, [k]);
  return (
    <button
      type="button"
      className={styles.term}
      onClick={(e) => {
        e.stopPropagation();
        show(k);
      }}
      aria-label={`${typeof children === "string" ? children : label} — what this means`}
    >
      {children ?? label}
    </button>
  );
}
