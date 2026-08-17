"use client";

/* Route-level boundary. Catches anything thrown while rendering a page inside
   the root layout, so the sidebar, header and tab bar survive and the user can
   navigate away instead of staring at Next's bare "Application error".

   Next requires this to be a client component and hands it `reset`, which
   re-renders the segment — worth offering, because most of what lands here is
   a bad row from one fetch rather than a permanent fault. */

import { useEffect } from "react";
import { ErrorCard, type AppError } from "@/components/ui/ErrorBoundary";

export default function Error({ error, reset }: { error: AppError; reset: () => void }) {
  useEffect(() => {
    console.error("page error:", error);
  }, [error]);

  return <ErrorCard error={error} reset={reset} />;
}
