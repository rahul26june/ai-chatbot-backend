import {
  deleteCachedResponse,
  getCache,
  setCache,
} from "./cache.service.js";
import {
  generateConversationCacheKey,
  generateConversationListCacheKey,
} from "./cache-key.service.js";

export function getCachedConversationList(userId) {
  return getCache(generateConversationListCacheKey(userId));
}

export function setCachedConversationList(userId, conversations) {
  return setCache(generateConversationListCacheKey(userId), conversations);
}

export function getCachedConversation(userId, conversationId) {
  return getCache(generateConversationCacheKey(userId, conversationId));
}

export function setCachedConversation(userId, conversationId, conversation) {
  return setCache(
    generateConversationCacheKey(userId, conversationId),
    conversation,
  );
}

export async function invalidateConversationCache(userId, conversationId) {
  const keys = [generateConversationListCacheKey(userId)];
  if (conversationId) {
    keys.push(generateConversationCacheKey(userId, conversationId));
  }
  await Promise.all(keys.map((key) => deleteCachedResponse(key)));
}
