import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGeminiProvider,
  extractTextDelta,
} from "../src/providers/gemini.provider.js";

describe("Gemini stream event parsing", () => {
  it("extracts text chunks from model step deltas", () => {
    assert.equal(extractTextDelta({
      event_type: "step.delta",
      delta: { type: "text", text: "Hello" },
    }), "Hello");
  });

  it("ignores non-text and lifecycle events", () => {
    assert.equal(extractTextDelta({
      event_type: "step.delta",
      delta: { type: "thought_signature", thought: "private" },
    }), "");
    assert.equal(extractTextDelta({
      event_type: "interaction.completed",
    }), "");
  });

  it("can be configured with a model and reports model metadata", () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      model: "configured-model",
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
    });
    assert.equal(provider.name, "gemini");
    assert.equal(provider.model, "configured-model");
    assert.equal(provider.inputCostPerMillion, 1);
    assert.equal(provider.outputCostPerMillion, 2);
  });
});
