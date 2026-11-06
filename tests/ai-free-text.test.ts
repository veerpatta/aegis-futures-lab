import { describe, expect, it } from "vitest";
import { cleanText, clipText } from "@/lib/ai-free/text";

describe("text from a model is made safe to store", () => {
  it("removes NUL characters and lone surrogates, keeping whole characters", () => {
    expect(cleanText("a\u0000b", 10)).toBe("ab");
    expect(cleanText("x\uD83Dy", 10)).toBe("xy");
    expect(cleanText("x\uDE00y", 10)).toBe("xy");
    expect(cleanText("ok 😀", 10)).toBe("ok 😀");
  });
  it("cuts by code points, never inside a character", () => {
    expect(cleanText("😀😀😀", 2)).toBe("😀😀");
    expect(Array.from(cleanText("a😀".repeat(1000), 1201)).length).toBe(1201);
    expect(clipText("abcdef", 5)).toBe("ab...");
    expect(clipText("abc", 5)).toBe("abc");
  });
  it("produces text Postgres and JSON accept", () => {
    const dirty = "\u0000reason\uD800 with emoji 😀 cut".repeat(50);
    const clean = cleanText(dirty, 1200);
    expect(clean).not.toMatch(/\u0000/);
    expect(() => JSON.parse(JSON.stringify({ clean }))).not.toThrow();
    expect(Buffer.from(clean, "utf8").toString("utf8")).toBe(clean);
  });
});
