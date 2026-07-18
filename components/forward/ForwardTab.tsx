"use client";

import { Panel } from "@/components/ui";
import type { ParamValues } from "@/lib/strategies/types";
import type { ExecutionSettings } from "@/components/lab/ExecutionPanel";

export default function ForwardTab(_props: {
  strategyId: string;
  params: ParamValues;
  execution: ExecutionSettings;
}) {
  return (
    <Panel title="Forward test">
      <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
        Coming next: run the selected strategy forward on the live delayed feed as a paper
        simulation that survives reloads.
      </span>
    </Panel>
  );
}
