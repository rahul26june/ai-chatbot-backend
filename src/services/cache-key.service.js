import { createHash } from "node:crypto";

export function generatePromptCacheKey(message, history = []) {
  const prompt = JSON.stringify({ version: "guardrails-v1", message, history });
  const digest = createHash("sha256").update(prompt).digest("hex");
  return `ai-response:${digest}`;
}

export function generateConversationListCacheKey(userId) {
  return `conversation-list:${userId}`;
}

export function generateConversationCacheKey(userId, conversationId) {
  return `conversation:${userId}:${conversationId}`;
}
