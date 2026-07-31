import { readFileSync } from "node:fs";
import { join } from "node:path";
import DiagnosticsClient from "@/components/diagnostics/DiagnosticsClient";
import HypothesisBoard from "@/components/diagnostics/HypothesisBoard";
import type { Phase1Report, Phase4Report } from "@/lib/diagnostics/report";

/* Reads the committed artefacts from disk rather than importing them, so the
   page renders an honest empty state when a measurement has not been run
   instead of failing the build. */
function load<T>(relative: string): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), relative), "utf8")) as T;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Diagnostics · Aegis",
  description: "Does the entry signal beat matched random entries?",
};

/* ORDER IS THE POINT. The Phase 1 verdict on the live streams comes FIRST and
   in full; the Phase 4 hypothesis board sits below it on the same scrolling
   page. New candidates are more interesting to look at than a refuted
   baseline, and moving the refutation to a second tab so the fresh ideas lead
   would be de-emphasising it — which the brief forbids, and which is how a
   research tool quietly turns back into a sales page. */
export default function DiagnosticsPage() {
  return (
    <>
      <DiagnosticsClient report={load<Phase1Report>("docs/research/phase1-random-entry.json")} />
      <HypothesisBoard report={load<Phase4Report>("docs/research/phase4-hypotheses.json")} />
    </>
  );
}
