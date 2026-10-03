import { Suspense } from "react";
import JournalClient from "@/components/replay/JournalClient";

export default function JournalPage() {
  return (
    <Suspense>
      <JournalClient />
    </Suspense>
  );
}
