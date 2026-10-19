import mongoose from "mongoose";
import {
  createConversation,
  deleteConversation,
  findConversation,
  listConversations,
} from "../repositories/conversation.repository.js";
import {
  getCachedConversation,
  getCachedConversationList,
  invalidateConversationCache,
  setCachedConversation,
  setCachedConversationList,
} from "../services/conversation-cache.service.js";

function formatConversation(conversation, includeMessages = true) {
  return {
    id: conversation._id.toString(),
    title: conversation.title,
    ...(includeMessages
      ? {
          messages: conversation.messages.map(({ role, text, createdAt }) => ({
            role,
            text,
            createdAt,
          })),
        }
      : {}),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function isValidConversationId(id) {
  return typeof id === "string" && mongoose.isValidObjectId(id);
}

export async function create(req, res) {
  try {
    const conversation = await createConversation(req.auth.userId);
    await invalidateConversationCache(req.auth.userId);
    return res.status(201).json({
      success: true,
      conversation: formatConversation(conversation),
    });
  } catch (error) {
    console.error("Unable to create conversation:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to create a conversation right now.",
    });
  }
}

export async function list(req, res) {
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (search.length > 100) {
    return res.status(400).json({
      success: false,
      error: "Search must be 100 characters or fewer.",
    });
  }

  try {
    const cachedConversations = search
      ? null
      : await getCachedConversationList(req.auth.userId);
    if (cachedConversations !== null) {
      return res.status(200).json({
        success: true,
        conversations: cachedConversations,
      });
    }

    const conversations = await listConversations(req.auth.userId, search);
    const formattedConversations = conversations.map((conversation) => (
      formatConversation(conversation, false)
    ));
    if (!search) {
      await setCachedConversationList(req.auth.userId, formattedConversations);
    }
    return res.status(200).json({
      success: true,
      conversations: formattedConversations,
    });
  } catch (error) {
    console.error("Unable to load conversations:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to load conversations right now.",
    });
  }
}

export async function get(req, res) {
  if (!isValidConversationId(req.params.id)) {
    return res.status(400).json({
      success: false,
      error: "Conversation ID is invalid.",
    });
  }

  try {
    const cachedConversation = await getCachedConversation(
      req.auth.userId,
      req.params.id,
    );
    if (cachedConversation !== null) {
      return res.status(200).json({
        success: true,
        conversation: cachedConversation,
      });
    }

    const conversation = await findConversation(req.auth.userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation was not found.",
      });
    }
    const formattedConversation = formatConversation(conversation);
    await setCachedConversation(
      req.auth.userId,
      req.params.id,
      formattedConversation,
    );
    return res.status(200).json({
      success: true,
      conversation: formattedConversation,
    });
  } catch (error) {
    console.error("Unable to load conversation:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to load this conversation right now.",
    });
  }
}

export async function remove(req, res) {
  if (!isValidConversationId(req.params.id)) {
    return res.status(400).json({
      success: false,
      error: "Conversation ID is invalid.",
    });
  }

  try {
    const conversation = await deleteConversation(req.auth.userId, req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation was not found.",
      });
    }
    await invalidateConversationCache(req.auth.userId, req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Unable to delete conversation:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to delete this conversation right now.",
    });
  }
}
