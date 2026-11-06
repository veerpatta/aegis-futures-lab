import { beforeEach, describe, expect, it, vi } from "vitest";
import { chat, NEMOTRON_ULTRA, resetAvailability } from "@/lib/ai-free/nvidia";

/* NVIDIA's gateway answers 502 when a non-streamed answer takes about 30 s
   (measured 2026-11-07); the provider streams so reasoning models can finish. */

const env = () => ({ NVIDIA_API_KEY: "nvapi-" + "x".repeat(40) });
function sse(events: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Split mid-line to prove the reader buffers partial lines.
      const all = events.map((e) => `data: ${e}\n\n`).join("");
      c.enqueue(enc.encode(all.slice(0, 37)));
      c.enqueue(enc.encode(all.slice(37)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (d: Record<string, unknown>) => JSON.stringify({ choices: [{ delta: d }] });

beforeEach(() => resetAvailability());

describe("streamed answers", () => {
  it("asks for a stream and adds up only the answer, not the reasoning", async () => {
    const fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      expect((init?.headers as Record<string, string>).Accept).toBe("text/event-stream");
      return sse([delta({ reasoning_content: "thinking hard" }), delta({ content: '{"decision":' }), delta({ reasoning: "more" }), delta({ content: '"skip"}' }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } }), "[DONE]"]);
    });
    const r = await chat({ system: "s", user: "u", models: [NEMOTRON_ULTRA] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() });
    expect(r.text).toBe('{"decision":"skip"}');
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it("treats a stream with reasoning but no answer as empty", async () => {
    const fetch = vi.fn(async () => sse([delta({ reasoning_content: "only thoughts" }), "[DONE]"]));
    await expect(chat({ system: "s", user: "u", models: [NEMOTRON_ULTRA] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() })).rejects.toMatchObject({ code: "empty" });
  });

  it("still reads a plain JSON answer from a deployment that ignores stream", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    expect((await chat({ system: "s", user: "u", models: [NEMOTRON_ULTRA] }, { fetch: fetch as unknown as typeof globalThis.fetch, env: env() })).text).toBe("ready");
  });
});
