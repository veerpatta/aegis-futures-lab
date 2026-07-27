import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// challenger-logic, not challenger: challenger.ts runs main() on import.
import { replaceDeclaration } from "../scripts/engine/challenger-logic";

/* Ring 2's time bomb.

   editOverrides used to require the literal EMPTY declaration in tiers.ts:

     export const CHALLENGER_OVERRIDES: Record<string, Partial<ParamValues>> = {};

   The moment a bot PR merges, that block holds the adopted value, the literal
   no longer matches, and every future proposal throws. openPr swallowed the
   throw, so the run printed "no challenger survives yet — nothing to propose"
   and exited 0: the self-training loop dead, with the log claiming the gate was
   working. These tests run against the REAL tiers.ts in both states. */

const TIERS = readFileSync("scripts/engine/tiers.ts", "utf8");

const OVERRIDES = "CHALLENGER_OVERRIDES";
const PROMOTED = "PROMOTED_SHADOWS";

describe("replaceDeclaration on the real tiers.ts", () => {
  it("fills the empty CHALLENGER_OVERRIDES block", () => {
    const out = replaceDeclaration(TIERS, OVERRIDES, JSON.stringify({ "B:MNQ": { oversold: 20 } }));
    expect(out).toContain(`= {"B:MNQ":{"oversold":20}};`);
    expect(out).not.toContain(`export const ${OVERRIDES}: Record<string, Partial<ParamValues>> = {};`);
  });

  it("REPLACES an already-adopted override instead of throwing", () => {
    // tiers.ts as it looks after one merged bot PR — the state that used to
    // kill Ring 2 permanently.
    const adopted = replaceDeclaration(TIERS, OVERRIDES, JSON.stringify({ "B:MES": { oversold: 25 } }));
    expect(adopted).toContain(`= {"B:MES":{"oversold":25}};`);
    const next = replaceDeclaration(adopted, OVERRIDES, JSON.stringify({ "B:MNQ": { targetR: 2 } }));
    expect(next).toContain(`= {"B:MNQ":{"targetR":2}};`);
    // The superseded value is gone, not appended alongside.
    expect(next).not.toContain(`{"B:MES":{"oversold":25}}`);
  });

  it("fills and then replaces PROMOTED_SHADOWS the same way", () => {
    const entry = `[{ label: "rsi", strategyId: "rsi-reversion", symbols: ["MES"] }]`;
    const once = replaceDeclaration(TIERS, PROMOTED, entry);
    expect(once).toContain(`symbols: ["MES"] }];`);
    const twice = replaceDeclaration(once, PROMOTED, `[{ label: "vwap", strategyId: "vwap-reversion", symbols: ["MNQ"] }]`);
    expect(twice).toContain(`label: "vwap"`);
    expect(twice).not.toContain(`label: "rsi"`);
  });

  it("leaves the rest of the file byte-identical", () => {
    const out = replaceDeclaration(TIERS, OVERRIDES, "{}");
    expect(out).toBe(TIERS);
  });

  it("refuses a file whose declaration is gone rather than guessing", () => {
    const mangled = TIERS.replace(`export const ${OVERRIDES}`, `const RENAMED_BY_A_HUMAN`);
    expect(() => replaceDeclaration(mangled, OVERRIDES, "{}")).toThrow(/declaration not found/);
  });
});
