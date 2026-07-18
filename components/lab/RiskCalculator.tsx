"use client";

import { useState } from "react";
import { POINT_VALUES, type FeedSymbol } from "@/lib/market/contracts";
import { Badge, Button, NumberField, Panel, SelectField } from "@/components/ui";
import styles from "./lab.module.css";

/* Port of calcRisk() from the legacy dashboard: whole contracts from the
   structural stop distance under an absolute dollar cap. */
export default function RiskCalculator() {
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState<FeedSymbol>("MES");
  const [entry, setEntry] = useState(6500);
  const [stop, setStop] = useState(6494);
  const [cost, setCost] = useState(2.4);
  const [openRisk, setOpenRisk] = useState(0);
  const [cap, setCap] = useState(160);

  const point = POINT_VALUES[symbol];
  const effectiveCap = Math.min(160, Math.max(0, cap));
  const available = Math.max(0, effectiveCap - Math.max(0, openRisk));
  const per = Math.abs(entry - stop) * point + Math.max(0, cost);
  const qty = per > 0 ? Math.floor(available / per) : 0;
  const total = qty * per;
  const allowed = qty > 0;

  return (
    <Panel
      title="Position size check"
      actions={
        <Button variant="ghost" small onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {!open ? (
        <span className={styles.note}>
          Quick sizing: whole contracts from a structural stop under the $160 risk cap.
        </span>
      ) : (
        <>
          <div className={styles.riskGrid}>
            <SelectField
              label="Instrument"
              value={symbol}
              onChange={(v) => setSymbol(v as FeedSymbol)}
              options={[
                { value: "MES", label: "MES ($5/pt)" },
                { value: "MNQ", label: "MNQ ($2/pt)" },
              ]}
            />
            <NumberField label="Risk cap" value={cap} onChange={setCap} min={0} max={160} step={10} unit="$" />
            <NumberField label="Entry" value={entry} onChange={setEntry} step={0.25} />
            <NumberField label="Stop" value={stop} onChange={setStop} step={0.25} />
            <NumberField label="Cost / contract" value={cost} onChange={setCost} min={0} step={0.1} unit="$" />
            <NumberField label="Open risk" value={openRisk} onChange={setOpenRisk} min={0} step={10} unit="$" />
          </div>
          <div className={styles.riskOut}>
            <div>
              <Badge tone={allowed ? "green" : "red"}>{allowed ? "ALLOWED" : "REJECTED"}</Badge>{" "}
              <b className="num">
                {qty} contract{qty === 1 ? "" : "s"}
              </b>
            </div>
            <span className={styles.note}>
              Risk/contract ${per.toFixed(2)} · stop {Math.abs(entry - stop).toFixed(2)} pts ·
              planned loss ${total.toFixed(2)} of ${available.toFixed(0)} available.
            </span>
          </div>
          {!allowed && (
            <p className={styles.note}>
              One contract cannot fit the remaining budget — v5 would refine the entry to a 15M
              zone inside the 1H.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
