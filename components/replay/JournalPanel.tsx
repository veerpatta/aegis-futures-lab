"use client";

import { useEffect, useRef, useState } from "react";
import {
  journalTradesToCsv,
  parseJournalCsv,
  saveJournal,
  type JournalStore,
  type JournalTrade,
} from "@/lib/journal";
import { journalPnl } from "@/lib/journal";
import { parseBrokerCsv } from "@/lib/journal/broker";
import { fetchCloudJournal, mirrorJournalToCloud } from "@/lib/journal/cloud";
import { nyDateKey, nyTimeToUnix } from "@/lib/time/ny";
import { clockIn, etWallIn, ZONE_ABBR, type DisplayZone } from "@/lib/time/zones";
import { useZone } from "@/components/providers/ZoneProvider";
import type { FeedSymbol } from "@/lib/market/contracts";
import { money } from "@/lib/format";
import { Badge, Button, DataTable, Panel } from "@/components/ui";
import styles from "./replay.module.css";

/* "My trades" journal: quick manual entry for the selected day (times typed
   as ET), bulk CSV import, and per-day list. Persisted to localStorage on
   every change; nothing leaves the browser. */

function parseClock(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function dedupeKey(t: JournalTrade): string {
  return `${t.symbol}|${t.side}|${t.entryTime}|${t.entryPrice}`;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* The two clock fields are always ET — they have to line up with the chart and
   with the engine's own timestamps. When the app is showing IST, echo what the
   typed ET time means on an Indian clock so nobody has to do the arithmetic. */
function istEcho(hhmm: string, zone: DisplayZone): React.ReactNode {
  if (zone !== "IST" || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  return <span className={styles.fieldEcho}> = {etWallIn(hhmm, "IST")} IST</span>;
}

export default function JournalPanel({
  selectedDay,
  journal,
  onChange,
}: {
  selectedDay: string;
  journal: JournalStore;
  onChange: (store: JournalStore) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { zone } = useZone();
  const [error, setError] = useState<string | null>(null);
  const [cloud, setCloud] = useState<"syncing" | "ok" | "offline">("syncing");
  const [form, setForm] = useState({
    symbol: "MES" as FeedSymbol,
    side: "LONG" as "LONG" | "SHORT",
    qty: "1",
    entryClock: "09:35",
    entryPrice: "",
    exitClock: "10:00",
    exitPrice: "",
    notes: "",
  });

  const commit = (trades: JournalTrade[]) => {
    const store: JournalStore = { version: 1, trades };
    saveJournal(store);
    onChange(store);
    mirrorJournalToCloud(trades)
      .then(() => setCloud("ok"))
      .catch(() => setCloud("offline"));
  };

  /* On first mount, pull any journal trades that only exist in the cloud
     (another browser/device) and push local-only trades up. */
  useEffect(() => {
    let alive = true;
    fetchCloudJournal()
      .then((remote) => {
        if (!alive) return;
        const localIds = new Set(journal.trades.map((t) => t.id));
        const fresh = remote.filter((t) => !localIds.has(t.id));
        const merged = fresh.length
          ? [...journal.trades, ...fresh].sort((a, b) => a.entryTime - b.entryTime)
          : journal.trades;
        if (fresh.length) {
          const store: JournalStore = { version: 1, trades: merged };
          saveJournal(store);
          onChange(store);
        }
        return mirrorJournalToCloud(merged).then(() => {
          if (alive) setCloud("ok");
        });
      })
      .catch(() => {
        if (alive) setCloud("offline");
      });
    return () => {
      alive = false;
    };
    // mount-only: the merge must not loop on every journal change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addManual = () => {
    setError(null);
    const entryMin = parseClock(form.entryClock);
    const exitMin = parseClock(form.exitClock);
    const qty = Math.floor(Number(form.qty));
    const entryPrice = Number(form.entryPrice);
    const exitPrice = Number(form.exitPrice);
    if (entryMin === null || exitMin === null) return setError("Times must be HH:MM (ET).");
    if (exitMin < entryMin) return setError("Exit time is before entry time.");
    if (!Number.isFinite(qty) || qty <= 0) return setError("Quantity must be a positive number.");
    if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0 || exitPrice <= 0)
      return setError("Entry and exit prices are required.");
    const trade: JournalTrade = {
      id: `manual-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      symbol: form.symbol,
      side: form.side,
      qty,
      entryTime: nyTimeToUnix(selectedDay, entryMin),
      entryPrice,
      exitTime: nyTimeToUnix(selectedDay, exitMin),
      exitPrice,
      notes: form.notes.trim() || undefined,
      createdAt: Math.floor(Date.now() / 1000),
    };
    commit([...journal.trades, trade].sort((a, b) => a.entryTime - b.entryTime));
    setForm((f) => ({ ...f, entryPrice: "", exitPrice: "", notes: "" }));
  };

  const importCsv = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      let parsed: JournalTrade[];
      let brokerSkipped = 0;
      try {
        parsed = parseJournalCsv(text);
      } catch (journalErr) {
        // Not the journal schema — try broker exports (Tradovate / Topstep).
        try {
          const broker = parseBrokerCsv(text);
          parsed = broker.trades;
          brokerSkipped = broker.skipped;
        } catch {
          throw journalErr;
        }
      }
      const seen = new Set(journal.trades.map(dedupeKey));
      const fresh = parsed.filter((t) => !seen.has(dedupeKey(t)));
      commit([...journal.trades, ...fresh].sort((a, b) => a.entryTime - b.entryTime));
      const notes: string[] = [];
      if (fresh.length < parsed.length)
        notes.push(`${parsed.length - fresh.length} duplicates skipped`);
      if (brokerSkipped) notes.push(`${brokerSkipped} non-MES/MNQ rows skipped`);
      if (notes.length) setError(`Imported ${fresh.length} trades (${notes.join(", ")}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (id: string) => commit(journal.trades.filter((t) => t.id !== id));

  const dayTrades = journal.trades.filter((t) => nyDateKey(t.entryTime) === selectedDay);

  return (
    <Panel
      title="My trades (journal)"
      hint={`${journal.trades.length} total · ${
        cloud === "ok" ? "synced to cloud" : cloud === "syncing" ? "syncing…" : "cloud offline — saved locally"
      }`}
      actions={
        <span className={styles.formActions} style={{ marginTop: 0 }}>
          <Button small onClick={() => fileRef.current?.click()}>
            Import CSV
          </Button>
          <Button
            small
            disabled={!journal.trades.length}
            onClick={() => download("my-trades.csv", journalTradesToCsv(journal.trades))}
          >
            Export
          </Button>
        </span>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importCsv(f);
          e.target.value = "";
        }}
      />
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Symbol
          <select
            value={form.symbol}
            onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value as FeedSymbol }))}
          >
            <option value="MES">MES</option>
            <option value="MNQ">MNQ</option>
          </select>
        </label>
        <label className={styles.field}>
          Side
          <select
            value={form.side}
            onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as "LONG" | "SHORT" }))}
          >
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label className={styles.field}>
          Qty
          <input
            inputMode="numeric"
            value={form.qty}
            onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Entry (ET){istEcho(form.entryClock, zone)}
          <input
            placeholder="09:35"
            value={form.entryClock}
            onChange={(e) => setForm((f) => ({ ...f, entryClock: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Entry price
          <input
            inputMode="decimal"
            value={form.entryPrice}
            onChange={(e) => setForm((f) => ({ ...f, entryPrice: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Exit (ET){istEcho(form.exitClock, zone)}
          <input
            placeholder="10:00"
            value={form.exitClock}
            onChange={(e) => setForm((f) => ({ ...f, exitClock: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Exit price
          <input
            inputMode="decimal"
            value={form.exitPrice}
            onChange={(e) => setForm((f) => ({ ...f, exitPrice: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Notes
          <input
            placeholder="optional"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </label>
      </div>
      <div className={styles.formActions}>
        <Button variant="primary" small onClick={addManual}>
          Add to {selectedDay}
        </Button>
        <span className={styles.note}>
          Times are typed as New York (ET) wall clock, matching the chart — that stays
          true whichever clock the rest of the app is showing. Import accepts the
          journal schema (entry_time, exit_time, symbol, side, qty, entry, exit[, notes])
          or a Tradovate/Topstep performance export — MES/MNQ rows are picked out
          automatically.
        </span>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <div style={{ marginTop: "var(--space-3)" }}>
        <DataTable
          mobileCards={{ titleIndexes: [0, 1, 5] }}
          columns={["Entry", "Sym", "Side", "Qty", "In → Out", "Gross P&L", ""]}
          rows={dayTrades.map((t) => {
            const { grossPnl } = journalPnl(t);
            return [
              `${clockIn(t.entryTime, zone)}–${clockIn(t.exitTime, zone)} ${ZONE_ABBR[zone]}`,
              t.symbol,
              <Badge key="s" tone={t.side === "LONG" ? "green" : "red"}>
                {t.side}
              </Badge>,
              t.qty,
              `${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}`,
              <span key="p" style={{ color: grossPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                {money(grossPnl)}
              </span>,
              <Button key="x" small variant="ghost" onClick={() => remove(t.id)}>
                ✕
              </Button>,
            ];
          })}
          empty={`No journal trades on ${selectedDay} — add one above or import a CSV.`}
        />
      </div>
    </Panel>
  );
}
