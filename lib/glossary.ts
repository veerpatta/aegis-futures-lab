/* Plain meanings for every trading or research word the app puts on screen.

   One source for three readers: the tap-a-word sheet (components/ui/Term.tsx),
   the Guide's "Words you'll see" list (app/guide/page.tsx renders straight
   from this table) and docs/USER-MANUAL.md, which copies the same wording.
   Written for someone who knows trading but not software, and for someone who
   knows neither: one or two short sentences, no other jargon inside a
   definition unless that word has its own entry. */

export interface GlossaryEntry {
  term: string;
  meaning: string;
}

export const GLOSSARY = {
  paper: {
    term: "Paper trading",
    meaning:
      "Practice trades with imaginary money. Every trade in this app is a paper trade. Nothing here touches real money.",
  },
  delayed: {
    term: "Delayed prices",
    meaning:
      "Prices here are 10 to 15 minutes old, and trade ideas arrive 5 to 15 minutes after the setup. Never use them as a live order.",
  },
  practiceMoney: {
    term: "Practice money",
    meaning:
      "The bot's own $10,000 paper account. It only trades once a method has passed every test. Trade ideas are a separate record.",
  },
  experimentalLearner: {
    term: "Experimental learner",
    meaning:
      "The bot's own virtual $10,000 account. It takes trade ideas by itself, records every take and skip, and learns under fixed rules. Its results are evidence being collected, not proof.",
  },
  virtualEquity: {
    term: "Virtual equity",
    meaning:
      "What the learner's pretend account is worth now: $10,000 plus finished results plus an estimate for open trades. It is pretend money only.",
  },
  modelVersion: {
    term: "Model version",
    meaning:
      "The rule the learner uses to take or skip ideas. Version 1 takes every idea. Later versions are small models trained on the learner's own finished trades.",
  },
  challenger: {
    term: "Candidate",
    meaning:
      "A new model version tested side by side with the current one on the same fresh ideas. It takes over only after every check passes, twice.",
  },
  rolledBack: {
    term: "Rolled back",
    meaning:
      "A version that took over was put back to the previous one because it did worse or gave an unusable answer. A rolled-back version can never return.",
  },
  shadowResult: {
    term: "Shadow result",
    meaning:
      "What an idea would have done with one contract, whether the learner took it or not. It lets the learner learn from skipped ideas too.",
  },
  synthetic: {
    term: "Synthetic prices",
    meaning:
      "Made-up test prices used to prove the software works. Results on them never count as evidence that anything makes money.",
  },
  historicalPractice: {
    term: "Historical practice",
    meaning:
      "The bot replays older market data, deciding each idea only with what it could have known then. It can prepare a candidate, but never counts as fresh trading days and never changes the virtual account.",
  },
  developmentExposed: {
    term: "Already seen",
    meaning:
      "A stretch of older data that earlier research has already looked at. A result on it is practice, not proof, because the methods were shaped while looking at it.",
  },
  tradeIdea: {
    term: "Trade idea",
    meaning:
      "A buy or sell setup the bot spotted and then followed to its end on delayed prices. It is a simulated record, not a trade in the practice account.",
  },
  mes: {
    term: "MES · S&P micro",
    meaning:
      "The Micro E-mini S&P 500 future. Each 1-point move is worth $5 per contract.",
  },
  mnq: {
    term: "MNQ · Nasdaq micro",
    meaning:
      "The Micro E-mini Nasdaq-100 future. Each 1-point move is worth $2 per contract.",
  },
  entry: {
    term: "Entry",
    meaning: "The price where the idea gets in.",
  },
  stop: {
    term: "Stop",
    meaning:
      "The price that proves the idea wrong. If price reaches it, the trade closes with a planned loss. Fast markets can fill a little beyond it.",
  },
  target: {
    term: "Target",
    meaning: "The price where the idea takes its profit.",
  },
  reward: {
    term: "Reward to risk",
    meaning:
      "How far the target is compared with the stop. 1.5 : 1 means the possible gain is one and a half times the possible loss.",
  },
  zone: {
    term: "Zone",
    meaning:
      "A price area where strong buying or selling showed up before. Buy areas sit below price, sell areas above it.",
  },
  fresh: {
    term: "Fresh zone",
    meaning: "A zone price has not come back to yet. Tested means it has been touched once already.",
  },
  flat: {
    term: "Flat by 15:25 ET",
    meaning:
      "Every idea closes by 15:25 New York time, just before the session ends. No overnight positions.",
  },
  newsPause: {
    term: "News pause",
    meaning:
      "The bot takes no new ideas from 30 minutes before to 30 minutes after big US news like CPI, jobs or a Fed decision.",
  },
  winRate: {
    term: "Win rate",
    meaning:
      "The share of closed trades that made money. A high win rate can still lose money if the losses are bigger than the wins.",
  },
  profitFactor: {
    term: "Profit factor",
    meaning:
      "Money won divided by money lost. Above 1 means winners outweigh losers; below 1 means the method lost money.",
  },
  expectancy: {
    term: "Expectancy",
    meaning: "The average result per trade after costs. Below zero means each trade loses money on average.",
  },
  sampleSize: {
    term: "n (sample size)",
    meaning:
      "How many trades a number is based on. Under 30 is too few to judge, so those numbers are shown faded and marked amber.",
  },
  confidence: {
    term: "Likely range",
    meaning:
      "Where the true value probably sits, given how few trades there are. A wide range means the number could easily be luck.",
  },
  costs: {
    term: "Costs",
    meaning:
      "Commission ($1.20 per side per contract) and one tick of slippage on the way in and out. Every result here is after costs.",
  },
  slippage: {
    term: "Slippage",
    meaning: "Getting filled at a slightly worse price than planned. The app charges it on every trade.",
  },
  equity: {
    term: "Equity",
    meaning: "What the practice account is worth right now, including any open trade.",
  },
  openRisk: {
    term: "Open risk",
    meaning: "How much the practice account could lose if every open trade hit its stop.",
  },
  drawdown: {
    term: "Drawdown",
    meaning:
      "How far the account has fallen from its highest point. A $2,000 drawdown locks the practice account until it is reset.",
  },
  randomTest: {
    term: "Beat-random test",
    meaning:
      "The method's trades are compared with thousands of random entries on the same days. If it cannot beat random entries, it has no real edge.",
  },
  refuted: {
    term: "Hasn't beaten chance",
    meaning:
      "The method was tested on years of data and did no better than random entries. Its ideas are kept as a record, not as advice.",
  },
  untested: {
    term: "Not tested yet",
    meaning:
      "Nobody has run the beat-random test on this method yet. Untested is not the same as losing — it just isn't known.",
  },
  forwardEvidence: {
    term: "New trades",
    meaning:
      "Trades the bot recorded live, as the prices arrived. Past replays never count, so a method has to prove itself going forward.",
  },
  qualify: {
    term: "Qualify",
    meaning:
      "To trade practice money a method needs: a passed history test, a separate confirmation, 60 new trades over 20 trading days, and two weekly reviews.",
  },
  probation: {
    term: "Probation",
    meaning: "A newly qualified method trades practice money at half risk ($50 per trade) until another weekly review passes.",
  },
  tier: {
    term: "Zone setup and daily flow",
    meaning:
      "The two kinds of trade ideas. Zone setups are rare returns to strong price areas. Daily flow fades short sharp moves, at most twice a day.",
  },
  breaker: {
    term: "Paused by the breaker",
    meaning:
      "When a kind of idea loses too often lately, the bot keeps simulating it but hides it from the results until it recovers.",
  },
  journal: {
    term: "Journal",
    meaning:
      "Your own trades, typed in or imported from your broker. They stay separate from the bot and are private to you.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];
