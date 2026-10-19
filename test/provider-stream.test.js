import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAnthropicProvider } from "../src/providers/anthropic.provider.js";
import { createOpenAICompatibleProvider } from "../src/providers/openai-compatible.provider.js";

describe("provider streaming adapters", () => {
  it("streams OpenAI-compatible text and usage events", async () => {
    const provider = createOpenAICompatibleProvider({
      name: "openai",
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://example.invalid/v1",
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
      fetchImpl: async () => new Response([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"world"}}]}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join("\n"), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    const events = [];
    for await (const event of provider.generateResponseStream("prompt")) {
      events.push(event);
    }

    assert.deepEqual(events, [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
    ]);
  });

  it("streams Claude text deltas and usage events", async () => {
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      model: "test-model",
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
      fetchImpl: async () => new Response([
        "event: message_start",
        'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","usage":{"output_tokens":3}}',
        "",
      ].join("\n"), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    const events = [];
    for await (const event of provider.generateResponseStream("prompt")) {
      events.push(event);
    }

    assert.deepEqual(events, [
      { type: "usage", usage: { inputTokens: 5, outputTokens: 0 } },
      { type: "text", text: "Hello" },
      { type: "usage", usage: { inputTokens: null, outputTokens: 3 } },
    ]);
  });
});
