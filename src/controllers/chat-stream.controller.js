import mongoose from "mongoose";
import {
  createConversation,
  findConversation,
} from "../repositories/conversation.repository.js";
import { invalidateConversationCache } from "../services/conversation-cache.service.js";
import { logger, logException } from "../observability/logger.js";
import { captureException } from "../observability/error-monitoring.js";
import { recordStreamMetrics } from "../observability/metrics.js";
import {
  createChatResponseStream,
  estimateProviderCost,
  normalizeTokenUsage,
} from "../services/ai.service.js";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 19;

function conversationTitle(message) {
  const title = message.trim();
  return title.length > 34 ? `${title.slice(0, 34).trimEnd()}…` : title;
}

function validateChatRequest(body = {}) {
  const { message, history = [], conversationId } = body;
  if (
    typeof message !== "string"
    || !message.trim()
    || message.length > MAX_MESSAGE_LENGTH
  ) {
    return { error: `Message must contain between 1 and ${MAX_MESSAGE_LENGTH} characters.` };
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
    return { error: "Conversation history is invalid." };
  }
  if (
    conversationId !== undefined
    && (typeof conversationId !== "string" || !mongoose.isValidObjectId(conversationId))
  ) {
    return { error: "Conversation ID is invalid." };
  }
  return {
    message,
    history: history.slice(-MAX_HISTORY_MESSAGES),
    conversationId,
  };
}

function sendEvent(res, event) {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function formatConversation(conversation) {
  return {
    id: conversation._id.toString(),
    title: conversation.title,
    messages: conversation.messages.map(({ role, text, createdAt }) => ({
      role,
      text,
      createdAt,
    })),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export default async function streamChatController(req, res) {
  const input = validateChatRequest(req.body);
  if (input.error) {
    return res.status(400).json({ success: false, error: input.error });
  }

  const { message, history, conversationId } = input;
  let conversation;
  try {
    conversation = conversationId
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
  } catch (error) {
    logException("chat.stream.prepare_failed", error, { requestId: req.id });
    captureException(error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "Unable to start the chat response.",
    });
  }

  const requestId = req.id;
  const startedAt = performance.now();
  const abortController = new AbortController();
  let firstTokenAt;
  let answer = "";
  let cached = false;
  let completed = false;
  let generationError;
  let usage = null;
  let provider;
  let model;
  let providerPricing;

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });
  sendEvent(res, {
    type: "meta",
    requestId,
    conversationId: conversation._id.toString(),
  });

  try {
    const response = await createChatResponseStream(
      message,
      conversationId
        ? conversation.messages.slice(-MAX_HISTORY_MESSAGES).map(({ role, text }) => ({ role, text }))
        : history,
      { signal: abortController.signal },
    );
    cached = response.cached;
    provider = response.provider;
    model = response.model;
    providerPricing = response;

    for await (const item of response.stream) {
      if (abortController.signal.aborted) break;
      if (item?.type === "usage") {
        const nextUsage = normalizeTokenUsage(item.usage);
        if (nextUsage) {
          usage = {
            inputTokens: nextUsage.inputTokens ?? usage?.inputTokens ?? null,
            outputTokens: nextUsage.outputTokens ?? usage?.outputTokens ?? null,
          };
        }
        continue;
      }
      const text = typeof item === "string" ? item : item?.text;
      if (typeof text !== "string" || !text) continue;
      if (firstTokenAt === undefined) firstTokenAt = performance.now();
      answer += text;
      sendEvent(res, { type: "delta", text });
    }
    completed = !abortController.signal.aborted;
  } catch (error) {
    if (!abortController.signal.aborted) {
      generationError = error;
    }
  }

  let formattedConversation;
  if (completed || answer || abortController.signal.aborted) {
    try {
      if (conversation.messages.length === 0) {
        conversation.title = conversationTitle(message);
      }
      conversation.messages.push({ role: "user", text: message.trim() });
      if (answer) {
        conversation.messages.push({ role: "assistant", text: answer });
      }
      await conversation.save();
      await invalidateConversationCache(req.auth.userId, conversation._id.toString());
      formattedConversation = formatConversation(conversation);
    } catch (error) {
      generationError = error;
      logException("chat.stream.persistence_error", error, {
        requestId,
        conversationId: conversation._id.toString(),
      });
      captureException(error, { requestId });
    }
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const timeToFirstTokenMs = firstTokenAt === undefined
    ? null
    : Math.round(firstTokenAt - startedAt);
  const cost = estimateProviderCost(providerPricing ?? {}, usage);
  const result = generationError
      ? "chat.stream.failed"
      : completed
        ? "chat.stream.completed"
        : "chat.stream.cancelled";
  recordStreamMetrics({
    provider,
    model,
    result,
    cached,
    usage,
    estimatedCostUsd: cost.estimatedCostUsd,
  });
  logger.info(result, {
    requestId,
    conversationId: conversation._id.toString(),
    durationMs,
    timeToFirstTokenMs,
    outputCharacters: answer.length,
    cached,
    provider,
    model,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    estimatedCostUsd: cost.estimatedCostUsd,
    costConfigured: cost.costConfigured,
  });
  if (generationError) captureException(generationError, { requestId });

  if (generationError) {
    if (!res.destroyed && !res.writableEnded) {
      sendEvent(res, {
        type: "error",
        error: "An error occurred while generating the response.",
      });
      res.end();
    }
    return;
  }
  if (!res.destroyed && !res.writableEnded) {
    sendEvent(res, {
      type: "done",
      stopped: !completed,
      conversation: formattedConversation,
    });
    res.end();
  }
}
