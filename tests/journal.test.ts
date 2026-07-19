import { describe, it, expect } from "vitest";
import { nyMeta, nyTimeToUnix } from "@/lib/time/ny";
import { journalPnl, journalTradesToCsv, parseJournalCsv, type JournalTrade } from "@/lib/journal";
import { matchDay, matchAll, summarize } from "@/lib/journal/match";
import { tradesToCsv } from "@/lib/data/csv";
import type { SkipEvent } from "@/lib/backtest/engine";
import type { Trade } from "@/lib/types";

describe("nyTimeToUnix", () => {
  it("round-trips an EDT (summer) wall time", () => {
    const t = nyTimeToUnix("2026-07-06", 10 * 60 + 35); // Mon 10:35 ET
    expect(t).toBe(Date.UTC(2026, 6, 6, 14, 35) / 1000); // EDT = UTC-4
    const meta = nyMeta(t);
    expect(meta.dateKey).toBe("2026-07-06");
    expect(meta.minutes).toBe(10 * 60 + 35);
  });

  it("round-trips an EST (winter) wall time", () => {
    const t = nyTimeToUnix("2026-01-05", 10 * 60); // Mon 10:00 ET
    expect(t).toBe(Date.UTC(2026, 0, 5, 15, 0) / 1000); // EST = UTC-5
    const meta = nyMeta(t);
    expect(meta.dateKey).toBe("2026-01-05");
    expect(meta.minutes).toBe(600);
  });

  it("stays correct across the DST boundary week", () => {
    // US DST 2026 starts Sun Mar 8. Fri before vs Mon after.
    const before = nyTimeToUnix("2026-03-06", 600);
    const after = nyTimeToUnix("2026-03-09", 600);
    expect(nyMeta(before).minutes).toBe(600);
    expect(nyMeta(after).minutes).toBe(600);
    expect(before).toBe(Date.UTC(2026, 2, 6, 15, 0) / 1000); // EST
    expect(after).toBe(Date.UTC(2026, 2, 9, 14, 0) / 1000); // EDT
  });
});

function mkJournal(over: Partial<JournalTrade> = {}): JournalTrade {
  return {
    id: "j1",
    symbol: "MES",
    side: "LONG",
    qty: 2,
    entryTime: 1000,
    entryPrice: 5000,
    exitTime: 4000,
    exitPrice: 5010,
    createdAt: 0,
    ...over,
  };
}

function mkEngine(over: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    symbol: "MES",
    side: "LONG",
    qty: 1,
    entryTime: 1200,
    entryPrice: 5001,
    exitTime: 3600,
    exitPrice: 5011,
    stop: 4995,
    target: 5011,
    exitReason: "target",
    points: 10,
    pnl: 48,
    rMultiple: 2,
    ...over,
  };
}

describe("journal CSV", () => {
  it("parses ISO timestamps, aliases BUY/SELL, and sorts by entry", () => {
    const csv = [
      "entry_time,exit_time,symbol,side,qty,entry,exit,notes",
      "2026-07-06T14:35:00Z,2026-07-06T15:00:00Z,mes,BUY,2,5000,5010,scalp",
      "2026-07-06T13:40:00Z,2026-07-06T14:00:00Z,MNQ,sell,1,23000,22950,",
    ].join("\n");
    const trades = parseJournalCsv(csv);
    expect(trades.length).toBe(2);
    expect(trades[0].symbol).toBe("MNQ");
    expect(trades[0].side).toBe("SHORT");
    expect(trades[1].symbol).toBe("MES");
    expect(trades[1].side).toBe("LONG");
    expect(trades[1].notes).toBe("scalp");
    expect(trades[1].entryTime).toBe(Date.UTC(2026, 6, 6, 14, 35) / 1000);
  });

  it("parses unix-second timestamps", () => {
    const csv = ["entry_time,exit_time,symbol,side,qty,entry,exit", "1751812500,1751814000,MES,LONG,1,5000,5005"].join(
      "\n"
    );
    const t = parseJournalCsv(csv)[0];
    expect(t.entryTime).toBe(1751812500);
    expect(t.exitTime).toBe(1751814000);
  });

  it("rejects bad symbol, bad side, and exit-before-entry with row numbers", () => {
    const head = "entry_time,exit_time,symbol,side,qty,entry,exit";
    expect(() => parseJournalCsv(`${head}\n1000,2000,ES,LONG,1,1,2`)).toThrow(/row 2/);
    expect(() => parseJournalCsv(`${head}\n1000,2000,MES,HOLD,1,1,2`)).toThrow(/side/);
    expect(() => parseJournalCsv(`${head}\n3000,2000,MES,LONG,1,1,2`)).toThrow(/Exit before entry/);
  });

  it("re-imports an engine ledger export (superset columns)", () => {
    const engineCsv = tradesToCsv([mkEngine({ entryTime: 1751812500, exitTime: 1751814000 })]);
    const trades = parseJournalCsv(engineCsv);
    expect(trades.length).toBe(1);
    expect(trades[0].symbol).toBe("MES");
    expect(trades[0].entryPrice).toBe(5001);
  });

  it("round-trips its own export", () => {
    const src = [mkJournal({ entryTime: 1751812500, exitTime: 1751814000, notes: "note, with comma" })];
    const back = parseJournalCsv(journalTradesToCsv(src));
    expect(back.length).toBe(1);
    expect(back[0].entryPrice).toBe(src[0].entryPrice);
    expect(back[0].qty).toBe(src[0].qty);
  });
});

describe("journalPnl", () => {
  it("computes gross dollars from points × point value × qty", () => {
    expect(journalPnl(mkJournal()).grossPnl).toBe(10 * 5 * 2); // MES $5/pt
    expect(
      journalPnl(mkJournal({ symbol: "MNQ", side: "SHORT", entryPrice: 23000, exitPrice: 22990, qty: 1 })).grossPnl
    ).toBe(10 * 2);
  });
});

describe("trade matching", () => {
  it("matches same symbol+side with overlapping intervals", () => {
    const rows = matchDay([mkEngine()], [mkJournal()]);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("matched");
  });

  it("does not match across side or symbol", () => {
    const rows = matchDay([mkEngine({ side: "SHORT" })], [mkJournal()]);
    expect(rows.map((r) => r.kind).sort()).toEqual(["engineSkipped", "missedByYou"]);
  });

  it("greedily assigns the engine trade with the larger overlap", () => {
    const engineLate = mkEngine({ id: 2, entryTime: 3000, exitTime: 9000 });
    const userA = mkJournal({ id: "a", entryTime: 1000, exitTime: 4000 });
    const userB = mkJournal({ id: "b", entryTime: 3500, exitTime: 9000 });
    const rows = matchDay([engineLate], [userA, userB]);
    const matched = rows.find((r) => r.kind === "matched");
    expect(matched && matched.kind === "matched" && matched.user.id).toBe("b");
    expect(rows.filter((r) => r.kind === "engineSkipped").length).toBe(1);
  });

  it("explains engine-skipped trades with the nearest non-diagnostic event", () => {
    const events: SkipEvent[] = [
      { time: 900, date: "1970-01-01", reason: "evaluated", symbol: "MES" },
      { time: 950, date: "1970-01-01", reason: "qualified", symbol: "MES" },
      { time: 700, date: "1970-01-01", reason: "intermarket", symbol: "MES" },
      { time: 800, date: "1970-01-01", reason: "noTouch", symbol: "MNQ" },
    ];
    const rows = matchDay([], [mkJournal({ entryTime: 1000 })], events);
    expect(rows[0].kind).toBe("engineSkipped");
    if (rows[0].kind === "engineSkipped") {
      expect(rows[0].nearestSkip?.reason).toBe("intermarket");
    }
  });

  it("summarizes engine net vs user gross with counts", () => {
    const rows = matchDay(
      [mkEngine(), mkEngine({ id: 2, entryTime: 20000, exitTime: 21000, pnl: -30 })],
      [mkJournal()]
    );
    const s = summarize(rows);
    expect(s.matched).toBe(1);
    expect(s.missedByYou).toBe(1);
    expect(s.engineSkipped).toBe(0);
    expect(s.engineNet).toBe(48 - 30);
    expect(s.userGross).toBe(100);
  });

  it("matchAll groups by NY date", () => {
    const dayA = Date.UTC(2026, 6, 6, 14, 0) / 1000;
    const dayB = dayA + 86400;
    const out = matchAll(
      [mkEngine({ entryTime: dayA, exitTime: dayA + 600 })],
      [mkJournal({ entryTime: dayB, exitTime: dayB + 600 })]
    );
    expect(Object.keys(out)).toEqual(["2026-07-06", "2026-07-07"]);
    expect(out["2026-07-06"][0].kind).toBe("missedByYou");
    expect(out["2026-07-07"][0].kind).toBe("engineSkipped");
  });
});
