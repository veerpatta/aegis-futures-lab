"use client";

/* Device-local state, read AFTER mount rather than during render.

   `lib/data/storage.ts` is already SSR-safe — every helper returns null on the
   server. That is not the bug this fixes. The bug is WHERE the helpers were
   called: inside `useState(() => loadJournal())` and `useMemo(() => …, [])`,
   which run during the render pass. On a statically prerendered page the
   server renders with no storage and the browser's FIRST render — the
   hydration pass — renders with the user's real data. Different HTML, so React
   throws a hydration error and discards the server tree.

   The tell is that it only breaks for people who have used the app: an empty
   journal hydrates fine, and one logged trade turns the dashboard into Next's
   blank "Application error" page. That is why it survived so long.

   `ReplayClient` already does the right thing by hand ("start empty (SSR-safe),
   hydrate from localStorage on mount"). This is that pattern, once, so the
   remaining call sites cannot each get it subtly different. */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useStoredState<T>(
  load: () => T,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);

  /* Runs once, on mount, on the client only. `load` is deliberately NOT a
     dependency: callers pass an inline closure, so including it would re-read
     storage on every render and clobber any local edit the user just made. The
     loader is only ever "read this key", so a stale closure cannot read the
     wrong thing. */
  useEffect(() => {
    setValue(load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [value, setValue];
}

/* Read-only form, for the call sites that never write back. */
export function useStoredValue<T>(load: () => T, initial: T): T {
  return useStoredState(load, initial)[0];
}
