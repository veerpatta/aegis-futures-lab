import { readFileSync } from "node:fs";
import { join } from "node:path";
import DiagnosticsClient from "@/components/diagnostics/DiagnosticsClient";
import type { Phase1Report } from "@/lib/diagnostics/report";

/* Reads the committed Phase 1 artefact from disk rather than importing it, so
   the page renders an honest empty state when the measurement has not been run
   instead of failing the build. */
function loadReport(): Phase1Report | null {
  try {
    const path = join(process.cwd(), "docs/research/phase1-random-entry.json");
    return JSON.parse(readFileSync(path, "utf8")) as Phase1Report;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Diagnostics · Aegis",
  description: "Does the entry signal beat matched random entries?",
};

export default function DiagnosticsPage() {
  return <DiagnosticsClient report={loadReport()} />;
}
