import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateProviderCost,
  normalizeTokenUsage,
} from "../src/services/ai.service.js";

describe("AI usage and cost metrics", () => {
  it("normalizes provider usage field names", () => {
    assert.deepEqual(normalizeTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    }), {
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("estimates USD cost from configured per-million-token rates", () => {
    assert.deepEqual(estimateProviderCost({
      inputCostPerMillion: 2,
      outputCostPerMillion: 4,
    }, {
      inputTokens: 1000,
      outputTokens: 500,
    }), {
      estimatedCostUsd: 0.004,
      costConfigured: true,
    });
  });

  it("does not invent a cost when rates or usage are unavailable", () => {
    assert.deepEqual(estimateProviderCost({
      inputCostPerMillion: null,
      outputCostPerMillion: null,
    }, {
      inputTokens: 1000,
      outputTokens: 500,
    }), {
      estimatedCostUsd: null,
      costConfigured: false,
    });
    assert.deepEqual(estimateProviderCost({
      inputCostPerMillion: 1,
      outputCostPerMillion: 1,
    }, null), {
      estimatedCostUsd: null,
      costConfigured: true,
    });
    assert.deepEqual(estimateProviderCost({
      inputCostPerMillion: 1,
      outputCostPerMillion: 1,
    }, {
      inputTokens: 100,
      outputTokens: null,
    }), {
      estimatedCostUsd: null,
      costConfigured: true,
    });
  });
});
