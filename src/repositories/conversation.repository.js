import Conversation from "../models/conversation.model.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createConversation(userId) {
  return Conversation.create({ user: userId });
}

export function listConversations(userId, search = "") {
  const filter = { user: userId };
  const normalizedSearch = search.trim();
  if (normalizedSearch) {
    const pattern = new RegExp(escapeRegex(normalizedSearch), "i");
    filter.$or = [
      { title: pattern },
      { "messages.text": pattern },
    ];
  }

  return Conversation.find(filter)
    .sort({ updatedAt: -1 })
    .limit(100)
    .select("title updatedAt createdAt");
}

export function findConversation(userId, conversationId) {
  return Conversation.findOne({ _id: conversationId, user: userId });
}

export function deleteConversation(userId, conversationId) {
  return Conversation.findOneAndDelete({ _id: conversationId, user: userId });
}
