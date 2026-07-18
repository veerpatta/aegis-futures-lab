import { Suspense } from "react";
import CompareClient from "@/components/compare/CompareClient";

export default function ComparePage() {
  return (
    <Suspense>
      <CompareClient />
    </Suspense>
  );
}
