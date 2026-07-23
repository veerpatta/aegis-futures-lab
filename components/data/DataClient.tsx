"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseCsv } from "@/lib/data/csv";
import { getSupabase } from "@/lib/supabase/client";
import { useData } from "@/components/providers/DataProvider";
import { clockIn, ZONE_ABBR } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import { Badge, Button, NumberField, Panel } from "@/components/ui";
import { dateOnly, ts } from "@/lib/format";
import styles from "./data.module.css";

export default function DataClient() {
  const data = useData();
  const { zone } = useZone();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState("IMPORT");
  const [pointValue, setPointValue] = useState(5);
  const [importError, setImportError] = useState<string | null>(null);
  const [archive, setArchive] = useState<
    Partial<Record<"MES" | "MNQ", { count: number; first: number | null }>>
  >({});

  /* The cloud bar archive the engine fills on every pass — best effort. */
  useEffect(() => {
    const supabase = getSupabase();
    for (const s of ["MES", "MNQ"] as const) {
      Promise.all([
        supabase.from("bars_5m").select("time", { count: "exact", head: true }).eq("symbol", s),
        supabase.from("bars_5m").select("time").eq("symbol", s).order("time").limit(1),
      ])
        .then(([counted, first]) => {
          if (counted.error || first.error) return;
          setArchive((p) => ({
            ...p,
            [s]: {
              count: counted.count ?? 0,
              first: first.data?.length ? Number(first.data[0].time) : null,
            },
          }));
        })
        .catch(() => undefined);
    }
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const bars = parseCsv(await file.text());
      if (bars.length < 15) throw new Error("At least 15 candles are required.");
      data.setImported({
        label: label.trim().toUpperCase() || "IMPORT",
        pointValue: Math.max(0.01, pointValue),
        bars,
        importedAt: Date.now(),
      });
      data.setReplayCutoff(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const imported = data.imported;
  const replayIndex = useMemo(() => {
    if (!imported || data.replayCutoff === null) return imported ? imported.bars.length - 1 : 0;
    const idx = imported.bars.findLastIndex((b) => b.time <= data.replayCutoff!);
    return idx < 0 ? 0 : idx;
  }, [imported, data.replayCutoff]);

  return (
    <>
      <h1 className="pageTitle">Data</h1>
      <p className="pageSub">
        Import your own bars, replay history, and check exactly where every number comes from.
      </p>

      <div className={styles.grid}>
        <div className={styles.col}>
          <Panel title="CSV import" hint="parsed in your browser — never uploaded">
            <p className={styles.note}>
              Required columns: <code>timestamp,open,high,low,close</code> (optional{" "}
              <code>volume</code>). Timestamps may be ISO strings or unix seconds; 1-minute data
              is fine — the zone engine aggregates internally. Import replaces the previous one.
            </p>
            <div className={styles.importRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Instrument label</span>
                <input
                  className={styles.input}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={12}
                />
              </label>
              <NumberField
                label="Point value"
                value={pointValue}
                onChange={setPointValue}
                min={0.01}
                max={1000}
                step={0.5}
                unit="$/pt"
                help="MES = 5, MNQ = 2"
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              Choose CSV file
            </Button>
            {importError && <p className={styles.error}>{importError}</p>}
            {imported && (
              <p className={styles.note} style={{ marginBottom: 0 }}>
                <Badge tone="green">LOADED</Badge> {imported.label} ·{" "}
                {imported.bars.length.toLocaleString()} candles ·{" "}
                {dateOnly(imported.bars[0].time, zone)} → {dateOnly(imported.bars.at(-1)!.time, zone)} · $
                {imported.pointValue}/pt. Backtest it from the Lab page (Instruments → Imported
                CSV).
              </p>
            )}
          </Panel>

          <Panel title="Replay cutoff" hint="freeze the clock at a past bar">
            {!imported ? (
              <p className={styles.note}>
                Import a CSV first. The replay slider sets a cutoff time; the Markets signal
                readout then evaluates as if that bar had just closed — step through history and
                watch what each strategy would have said.
              </p>
            ) : (
              <>
                <input
                  type="range"
                  className={styles.range}
                  min={14}
                  max={imported.bars.length - 1}
                  value={replayIndex}
                  onChange={(e) =>
                    data.setReplayCutoff(imported.bars[Number(e.target.value)].time)
                  }
                />
                <p className={styles.note}>
                  {data.replayCutoff === null ? (
                    "Cutoff off — drag to enable."
                  ) : (
                    <>
                      Cutoff at <b>{ts(data.replayCutoff, zone)}</b> (bar {replayIndex + 1} of{" "}
                      {imported.bars.length}).{" "}
                    </>
                  )}
                </p>
                {data.replayCutoff !== null && (
                  <Button small onClick={() => data.setReplayCutoff(null)}>
                    Clear cutoff
                  </Button>
                )}
              </>
            )}
          </Panel>
        </div>

        <div className={styles.col}>
          <Panel title="Data provenance">
            <div className={styles.provList}>
              {(["MES", "MNQ"] as const).map((s) => {
                const st = data.history[s];
                return (
                  <div key={s} className={styles.provRow}>
                    <span className={styles.provLabel}>{s} history</span>
                    <span>
                      {st.status === "ready" ? (
                        <>
                          {st.bars.length.toLocaleString()} × 5m NY-session bars ·{" "}
                          {st.source} · fetched{" "}
                          {st.fetchedAt
                            ? `${clockIn(Math.floor(new Date(st.fetchedAt).getTime() / 1000), zone)} ${ZONE_ABBR[zone]}`
                            : "—"}
                        </>
                      ) : st.status === "error" ? (
                        <span style={{ color: "var(--red)" }}>{st.error}</span>
                      ) : (
                        "loading…"
                      )}
                    </span>
                  </div>
                );
              })}
              <div className={styles.provRow}>
                <span className={styles.provLabel}>Session filter</span>
                <span>09:30–15:30 America/New_York, weekdays, completed bars only</span>
              </div>
              <div className={styles.provRow}>
                <span className={styles.provLabel}>Archived history (grows daily)</span>
                <span>
                  every engine pass saves its 5-minute bars to a cloud archive, so history keeps
                  building past the feed&apos;s 60-day window
                  {(["MES", "MNQ"] as const).some((s) => archive[s]) && (
                    <>
                      {" — "}
                      {(["MES", "MNQ"] as const)
                        .filter((s) => archive[s])
                        .map(
                          (s) =>
                            `${s} ${archive[s]!.count.toLocaleString()} bars${
                              archive[s]!.first ? ` since ${dateOnly(archive[s]!.first!, zone)}` : ""
                            }`
                        )
                        .join(" · ")}
                    </>
                  )}
                </span>
              </div>
              <div className={styles.provRow}>
                <span className={styles.provLabel}>Economic calendar</span>
                <span>
                  {data.eventsSource ?? "unavailable"} · {data.events.length} verified events ·
                  unscheduled events require a licensed real-time calendar
                </span>
              </div>
              <div className={styles.provRow}>
                <span className={styles.provLabel}>Fills model</span>
                <span>
                  signals act on completed bars; fills at the next bar&apos;s open ± slippage;
                  stop-first same-bar resolution; flat by 15:25 NY
                </span>
              </div>
              <div className={styles.provRow}>
                <span className={styles.provLabel}>Storage</span>
                <span>
                  presets and the forward test live in your browser&apos;s localStorage; imported
                  CSVs stay in memory and are never uploaded
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Safety state">
            <p className={styles.note} style={{ margin: 0 }}>
              <Badge tone="amber">EXECUTION LOCKED</Badge> This is a free research edition: no
              broker connection exists in the codebase, all trading is simulated, and the
              delayed feed is display-only. Backtest results are a research proxy — fills,
              costs and data quality differ from live trading — not a performance claim.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
