import { Suspense } from "react";
import LabClient from "@/components/lab/LabClient";

export default function LabPage() {
  return (
    <Suspense>
      <LabClient />
    </Suspense>
  );
}
