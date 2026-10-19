import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProvider,
  createProviderManager,
  supportedProviders,
} from "../src/providers/provider.factory.js";

describe("AI provider factory", () => {
  it("registers each supported provider", () => {
    assert.deepEqual(supportedProviders, ["gemini", "openai", "deepseek", "claude"]);
  });

  it("applies provider model defaults and supports shared overrides", () => {
    const openai = createProvider("openai", { OPENAI_API_KEY: "test-key" });
    const deepseek = createProvider("deepseek", {
      DEEPSEEK_API_KEY: "test-key",
      AI_MODEL: "custom-model",
    });
    const claude = createProvider("claude", { ANTHROPIC_API_KEY: "test-key" });

    assert.equal(openai.name, "openai");
    assert.equal(openai.model, "gpt-4o-mini");
    assert.equal(deepseek.model, "custom-model");
    assert.equal(claude.name, "claude");
    assert.equal(typeof claude.generateResponseStream, "function");
  });

  it("validates missing credentials, unsupported providers, and invalid prices", () => {
    assert.throws(
      () => createProvider("openai", {}),
      /OPENAI_API_KEY is required/,
    );
    assert.throws(
      () => createProvider("unknown", {}),
      /Unsupported AI_PROVIDER/,
    );
    assert.throws(
      () => createProvider("gemini", {
        GEMINI_API_KEY: "test-key",
        GEMINI_INPUT_COST_PER_MILLION: "-1",
      }),
      /must be a non-negative number/,
    );
  });

  it("falls back after a primary provider fails before streaming text", async () => {
    const fallbackEvents = [];
    const manager = createProviderManager([
      {
        name: "primary",
        model: "primary-model",
        async generateResponse() {
          throw new Error("unavailable");
        },
        async *generateResponseStream() {
          throw new Error("unavailable");
        },
      },
      {
        name: "fallback",
        model: "fallback-model",
        async generateResponse() {
          return { text: "fallback response" };
        },
        async *generateResponseStream() {
          yield { type: "text", text: "fallback" };
        },
      },
    ], {
      onFallback: (event) => fallbackEvents.push(JSON.parse(event)),
    });

    const response = await manager.generateResponse("prompt");
    assert.equal(response.provider, "fallback");
    assert.equal(response.text, "fallback response");

    const { provider, stream } = await manager.openResponseStream("prompt");
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(provider.name, "fallback");
    assert.deepEqual(chunks, [{ type: "text", text: "fallback" }]);
    assert.equal(fallbackEvents.length, 2);
    assert.equal(fallbackEvents[0].nextProvider, "fallback");
  });

  it("does not switch providers after streamed text has started", async () => {
    const fallbackEvents = [];
    const manager = createProviderManager([
      {
        name: "primary",
        model: "primary-model",
        async generateResponse() {},
        async *generateResponseStream() {
          yield { type: "text", text: "partial" };
          throw new Error("connection lost");
        },
      },
      {
        name: "fallback",
        model: "fallback-model",
        async generateResponse() {},
        async *generateResponseStream() {
          yield { type: "text", text: "fallback" };
        },
      },
    ], {
      onFallback: (event) => fallbackEvents.push(JSON.parse(event)),
    });
    const { stream } = await manager.openResponseStream("prompt");
    const iterator = stream[Symbol.asyncIterator]();

    assert.deepEqual(await iterator.next(), {
      value: { type: "text", text: "partial" },
      done: false,
    });
    await assert.rejects(iterator.next(), /connection lost/);
    assert.deepEqual(fallbackEvents, []);
  });
});
