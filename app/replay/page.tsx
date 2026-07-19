import { Suspense } from "react";
import ReplayClient from "@/components/replay/ReplayClient";

export default function ReplayPage() {
  return (
    <Suspense>
      <ReplayClient />
    </Suspense>
  );
}
