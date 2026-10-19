import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateConversationCacheKey,
  generateConversationListCacheKey,
  generatePromptCacheKey,
} from "../src/services/cache-key.service.js";

describe("prompt cache keys", () => {
  it("is stable for the same prompt and history", () => {
    const history = [{ role: "user", text: "Earlier question" }];

    assert.equal(
      generatePromptCacheKey("Current question", history),
      generatePromptCacheKey("Current question", history),
    );
  });

  it("changes when the prompt or history changes", () => {
    const key = generatePromptCacheKey("Current question", []);

    assert.notEqual(key, generatePromptCacheKey("Different question", []));
    assert.notEqual(
      key,
      generatePromptCacheKey("Current question", [
        { role: "user", text: "Earlier question" },
      ]),
    );
  });

  it("does not expose prompt text in the Redis key", () => {
    const key = generatePromptCacheKey("private prompt text", []);

    assert.match(key, /^ai-response:[a-f0-9]{64}$/);
    assert.doesNotMatch(key, /private prompt text/);
  });

  it("scopes conversation cache keys to their owner", () => {
    assert.notEqual(
      generateConversationListCacheKey("user-one"),
      generateConversationListCacheKey("user-two"),
    );
    assert.notEqual(
      generateConversationCacheKey("user-one", "conversation"),
      generateConversationCacheKey("user-two", "conversation"),
    );
  });
});
