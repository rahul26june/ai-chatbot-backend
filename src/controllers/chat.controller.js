import chatWithAI from "../services/ai.service.js";
import mongoose from "mongoose";
import {
  createConversation,
  findConversation,
} from "../repositories/conversation.repository.js";
import { invalidateConversationCache } from "../services/conversation-cache.service.js";
import { logException } from "../observability/logger.js";
import { captureException } from "../observability/error-monitoring.js";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 19;

function conversationTitle(message) {
  const title = message.trim();
  return title.length > 34 ? `${title.slice(0, 34).trimEnd()}…` : title;
}

const chatController = async (req, res) => {
  const { message, history = [], conversationId } = req.body ?? {};

  if (
    typeof message !== "string"
    || !message.trim()
    || message.length > MAX_MESSAGE_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      error: `Message must contain between 1 and ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  if (
    !Array.isArray(history)
    || history.slice(-MAX_HISTORY_MESSAGES).some((item) => (
      !item
      || typeof item !== "object"
      || !["user", "assistant"].includes(item.role)
      || typeof item.text !== "string"
      || item.text.length > MAX_MESSAGE_LENGTH
    ))
  ) {
    return res.status(400).json({
      success: false,
      error: "Conversation history is invalid.",
    });
  }

  if (
    conversationId !== undefined
    && (typeof conversationId !== "string" || !mongoose.isValidObjectId(conversationId))
  ) {
    return res.status(400).json({
      success: false,
      error: "Conversation ID is invalid.",
    });
  }

  try {
    const conversation = conversationId
      ? await findConversation(req.auth.userId, conversationId)
      : await createConversation(req.auth.userId);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation was not found.",
      });
    }
    if (!conversationId) {
      await invalidateConversationCache(req.auth.userId);
    }

    const conversationHistory = conversationId
      ? conversation.messages.slice(-MAX_HISTORY_MESSAGES)
      : history.slice(-MAX_HISTORY_MESSAGES);
    const { answer } = await chatWithAI(
      message,
      conversationHistory.map(({ role, text }) => ({ role, text })),
    );
    if (conversation.messages.length === 0) {
      conversation.title = conversationTitle(message);
    }
    conversation.messages.push(
      { role: "user", text: message.trim() },
      { role: "assistant", text: answer },
    );
    await conversation.save();
    await invalidateConversationCache(
      req.auth.userId,
      conversation._id.toString(),
    );

    return res.status(200).json({
      success: true,
      answer,
      conversation: {
        id: conversation._id.toString(),
        title: conversation.title,
        messages: conversation.messages.map(({ role, text, createdAt }) => ({
          role,
          text,
          createdAt,
        })),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error) {
    logException("chat.request_failed", error, { requestId: req.id });
    captureException(error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "An error occurred while processing your request.",
    });
  }
};

export default chatController;