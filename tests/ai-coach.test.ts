import { describe, expect, it, vi } from "vitest";
import { FreeAiError, type ChatResult } from "@/lib/ai-free/nvidia";
import { stableHash } from "@/lib/experiment/hash";
import { dayFacts, tradeFacts, type DayRecord, type TradeRecord } from "@/lib/ai-coach/facts";
import { factNumbers, validateNote } from "@/lib/ai-coach/validate";
import { runCoach, type CoachNote, type CoachStore } from "@/lib/ai-coach/runner";

const decided = Date.parse("2026-11-06T15:10:00Z") / 1000;
const taken = (over: Partial<TradeRecord["position"]> = {}): TradeRecord => ({
  decisionKey: "learner-3:B:rsi-reversion:MES:1793977500", symbol: "MES", side: "SHORT", action: "take", reason: "taken", decidedAt: decided,
  idea: { strategy: "rsi-reversion", entry: 7437.75, stop: 7460.398386884567, target: 7403.77741967315 }, estRisk: "111.89",
  position: { status: "closed", qty: 1, fill: "7438.75", fillTs: decided, exit: "7460.65", exitTs: decided + 600, exitReason: "stop", net: "-111.89", cancelReason: null, ...over },
  outcome: { status: "closed", simStatus: "closed", net: "-111.89", exitReason: "stop", exit: "7460.65", exitTs: decided + 600, fill: "7438.75", fillTs: decided },
});
const skipped = (status: string, net: string | null = "162.8"): TradeRecord => ({
  ...taken(), action: "skip", reason: "risk-budget",
  position: { status: null, qty: null, fill: null, fillTs: null, exit: null, exitTs: null, exitReason: null, net: null, cancelReason: null },
  outcome: { status, simStatus: "closed", net, exitReason: "target", exit: "7403.9", exitTs: decided + 900, fill: "7438", fillTs: decided },
});

describe("coach facts", () => {
  it("describes a finished trade with the record's own numbers", () => {
    const f = tradeFacts(taken())!;
    expect(f).toMatchObject({ market: "S&P 500 micro", method: "RSI reversion", bot_action: "took the trade", contracts: 1, entry_price: 7438.75, exit_price: 7460.65, result_usd: -111.89, minutes_held: 10, result: "a loss" });
    expect(f.what_happened).toBe("hit its safety exit (the stop)");
    expect(f.stop_price).toBe(7460.4);
  });
  it("covers an unfilled order, a skipped idea and an idea that would not have filled", () => {
    expect(tradeFacts(taken({ status: "cancelled" }))).toMatchObject({ bot_action: "took the trade, but the order was never filled", result_usd: 0 });
    expect(tradeFacts(skipped("closed"))).toMatchObject({ bot_action: "skipped the idea", one_contract_result_had_it_been_taken_usd: 162.8, what_would_have_happened: "reached its profit target" });
    expect(tradeFacts(skipped("void", null))).toMatchObject({ what_would_have_happened: "it would not have been filled" });
  });
  it("is not ready for an unfinished decision", () => {
    expect(tradeFacts(taken({ status: "open" }))).toBeNull();
    expect(tradeFacts(skipped("pending"))).toBeNull();
  });
});

describe("coach note validation", () => {
  const facts = tradeFacts(taken())!;
  it("accepts a plain note that only uses the record's numbers, rounded or with commas", () => {
    const note = "The bot used virtual money to sell one S&P 500 micro contract at 7,438.75, betting the price would fall. Ten minutes later the price rose to its safety exit at 7,460.65, so the trade lost $112.";
    expect(validateNote(note, facts, "trade")).toEqual({ ok: true });
    expect(factNumbers({ a: -111.89, b: "Fri 10:10" })).toEqual([111.89, 10, 10]);
  });
  it("rejects invented numbers, advice, certainty and notes that forget it is virtual", () => {
    expect(validateNote("With virtual money the bot sold at 7,438.75 and lost $250 on the trade, which happens sometimes.", facts, "trade")).toEqual({ ok: false, reason: "unsupported-number" });
    expect(validateNote("With virtual money the bot lost $111.89. You should buy next time instead of selling into strength.", facts, "trade")).toMatchObject({ ok: false, reason: "advice" });
    expect(validateNote("With virtual money the bot lost $111.89, but the next trade will profit for sure, no doubt about it.", facts, "trade")).toMatchObject({ ok: false, reason: "prediction" });
    expect(validateNote("The bot sold one S&P 500 micro contract at 7,438.75 and the trade lost $111.89 ten minutes later.", facts, "trade")).toMatchObject({ ok: false, reason: "not-labelled-virtual" });
    expect(validateNote("Virtual money. " + "word ".repeat(200), facts, "trade")).toMatchObject({ ok: false, reason: "length" });
    expect(validateNote("**Virtual** money: the bot lost $111.89 on one S&P 500 micro trade today.", facts, "trade")).toMatchObject({ ok: false, reason: "markup" });
  });
});

describe("coach runner", () => {
  const day: DayRecord = { dayKey: "2026-11-06", decided: 1, taken: 1, skipped: 0, closed: 1, wins: 0, losses: 1, resultUsd: -111.89, open: 0, balanceUsd: 9888.11, sp500ChangePct: 0.72, nasdaqChangePct: 1.51 };
  function store(over: Partial<CoachStore> = {}) {
    const saved: CoachNote[] = [];
    const s: CoachStore = {
      activeExperiment: async () => "learner-3",
      finishedTrades: async () => [taken()],
      day: async () => day,
      latestDayNote: async () => null,
      save: async (n) => (saved.push(n), true),
      ...over,
    };
    return { s, saved };
  }
  const reply = (text: string): ChatResult => ({ model: "nvidia/nemotron-3-ultra-550b-a55b", text, usage: null, ms: 1, attempts: [] });
  const tradeText = "The bot used virtual money to sell one S&P 500 micro contract at 7,438.75. The price rose to the stop at 7,460.65 within 10 minutes, a loss of $111.89.";
  const dayText = "Friday was quiet for the bot, which trades virtual money. It decided 1 idea and took it, and that trade lost $111.89. The virtual balance is $9,888.11. The S&P 500 micro rose 0.72% and the Nasdaq-100 micro 1.51%.";

  it("writes a trade note and a day recap, accepted only after validation", async () => {
    const { s, saved } = store();
    const chat = vi.fn().mockResolvedValueOnce(reply(tradeText)).mockResolvedValueOnce(reply(dayText));
    const report = await runCoach({ store: s, chat, now: () => Date.parse("2026-11-06T16:00:00Z") }, { deadline: Date.parse("2026-11-06T16:00:40Z"), calls: 4 });
    expect(report).toEqual({ tradeNotes: 1, dayNotes: 1, rejected: 0, errors: 0 });
    expect(saved.map((n) => [n.kind, n.status])).toEqual([["trade", "accepted"], ["day", "accepted"]]);
    expect(saved[1].subject).toBe("2026-11-06");
    expect(saved[1].factsHash).toBe(stableHash(dayFacts(day)));
  });

  it("stores a failing note as rejected so it is never shown", async () => {
    const { s, saved } = store({ day: async () => null });
    const chat = vi.fn(async () => reply("The bot used virtual money and made $5,000 today, which is great news for everyone."));
    expect((await runCoach({ store: s, chat, now: () => 0 }, { deadline: 40_000, calls: 4 })).rejected).toBe(1);
    expect(saved[0]).toMatchObject({ status: "rejected", rejectReason: "unsupported-number" });
  });

  it("refreshes a day recap only when the day's facts change, at most hourly", async () => {
    const now = Date.parse("2026-11-06T16:00:00Z");
    const same = store({ finishedTrades: async () => [], latestDayNote: async () => ({ factsHash: stableHash(dayFacts(day)), createdAt: now - 7200_000 }) });
    const recent = store({ finishedTrades: async () => [], latestDayNote: async () => ({ factsHash: "other", createdAt: now - 600_000 }) });
    const chat = vi.fn(async () => reply(dayText));
    await runCoach({ store: same.s, chat, now: () => now }, { deadline: now + 40_000, calls: 4 });
    await runCoach({ store: recent.s, chat, now: () => now }, { deadline: now + 40_000, calls: 4 });
    expect(chat).not.toHaveBeenCalled();
  });

  it("counts a provider failure and carries on", async () => {
    const { s } = store({ day: async () => null });
    const chat = vi.fn(async () => { throw new FreeAiError("busy", 502); });
    expect(await runCoach({ store: s, chat, now: () => 0 }, { deadline: 40_000, calls: 4 })).toMatchObject({ errors: 1, tradeNotes: 0 });
  });
});
