import aiProvider from "../config/ai.config.js";
import {
  getCache,
  setCache,
} from "./cache.service.js";

import {
  generatePromptCacheKey,
} from "./cache-key.service.js";
import { logger } from "../observability/logger.js";
import { recordProviderUsage } from "../observability/metrics.js";
import {
  buildGuardedPrompt,
  limitGeneratedText,
  limitGeneratedStream,
  MAX_CHAT_RESPONSE_LENGTH,
} from "./guardrails.service.js";

const CONTEXT_WINDOW_MESSAGES = 20;

export function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = usage.inputTokens
    ?? usage.total_input_tokens
    ?? usage.prompt_tokens
    ?? usage.input_tokens;
  const outputTokens = usage.outputTokens
    ?? usage.total_output_tokens
    ?? usage.completion_tokens
    ?? usage.output_tokens;
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
  };
}

export function estimateProviderCost(provider, usage) {
  const normalizedUsage = normalizeTokenUsage(usage);
  const inputRate = provider.inputCostPerMillion;
  const outputRate = provider.outputCostPerMillion;
  const configured = inputRate !== null && inputRate !== undefined
    && outputRate !== null && outputRate !== undefined;
  if (
    !configured
    || !normalizedUsage
    || normalizedUsage.inputTokens === null
    || normalizedUsage.outputTokens === null
  ) {
    return { estimatedCostUsd: null, costConfigured: configured };
  }
  return {
    estimatedCostUsd: (
      normalizedUsage.inputTokens * inputRate
      + normalizedUsage.outputTokens * outputRate
    ) / 1_000_000,
    costConfigured: true,
  };
}

export function buildConversationContext(
  message,
  history = []
) {
  return [
    ...history,
    {
      role: "user",
      text: message,
    },
  ]
    .slice(-CONTEXT_WINDOW_MESSAGES)
    .map(
      ({ role, text }) =>
        `${
          role === "assistant"
            ? "Assistant"
            : "User"
        }: ${text}`
    )
    .join("\n\n");
}

async function chatWithAI(
  message,
  history = []
) {
  const cacheKey =
    generatePromptCacheKey(
      message,
      history
    );

  const cachedResponse =
    await getCache(cacheKey);

  if (typeof cachedResponse === "string") {
    logger.info("ai.cache.hit", {
      cache: "redis",
      provider: aiProvider.name,
      model: aiProvider.model,
    });

    return {
      answer: limitGeneratedText(cachedResponse, MAX_CHAT_RESPONSE_LENGTH),
      cached: true,
      usage: null,
    };
  }

  const prompt = buildGuardedPrompt(
    "Continue the conversation and respond to the latest user message.",
    { conversation: buildConversationContext(message, history) },
  );

  const result =
    await aiProvider.generateResponse(
      prompt
    );
  const generatedAnswer = typeof result === "string" ? result : result.text;
  const answer = limitGeneratedText(generatedAnswer, MAX_CHAT_RESPONSE_LENGTH);
  const usage = normalizeTokenUsage(typeof result === "string" ? null : result.usage);
  const provider = typeof result === "string" ? aiProvider : result;

  await setCache(
    cacheKey,
    answer
  );
  const cost = estimateProviderCost(provider, usage);
  recordProviderUsage({
    provider: provider.provider ?? provider.name,
    model: provider.model,
    usage,
    estimatedCostUsd: cost.estimatedCostUsd,
  });
  logger.info("ai.response.completed", {
    provider: provider.provider ?? provider.name,
    model: provider.model,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    ...cost,
  });

  return {
    answer,
    cached: false,
    usage,
  };
}

export async function createChatResponseStream(
  message,
  history = [],
  { signal } = {},
) {
  const cacheKey = generatePromptCacheKey(message, history);
  const cachedResponse = await getCache(cacheKey);
  if (typeof cachedResponse === "string") {
    logger.info("ai.cache.hit", {
      cache: "redis",
      provider: aiProvider.name,
      model: aiProvider.model,
    });
    return {
      cached: true,
      provider: aiProvider.name,
      model: aiProvider.model,
      inputCostPerMillion: aiProvider.inputCostPerMillion,
      outputCostPerMillion: aiProvider.outputCostPerMillion,
      stream: (async function* replayCachedResponse() {
        yield limitGeneratedText(cachedResponse, MAX_CHAT_RESPONSE_LENGTH);
      }()),
    };
  }

  const prompt = buildGuardedPrompt(
    "Continue the conversation and respond to the latest user message.",
    { conversation: buildConversationContext(message, history) },
  );
  const openedStream = await aiProvider.openResponseStream(prompt, { signal });
  const provider = openedStream.provider;
  const stream = (async function* cacheCompletedResponse() {
    let answer = "";
    for await (const item of limitGeneratedStream(
      openedStream.stream,
      MAX_CHAT_RESPONSE_LENGTH,
    )) {
      if (signal?.aborted) return;
      if (item?.type === "text" && typeof item.text === "string") {
        answer += item.text;
        yield item;
      } else if (item?.type === "usage") {
        yield { type: "usage", usage: normalizeTokenUsage(item.usage) };
      }
    }
    if (!signal?.aborted && answer) {
      await setCache(cacheKey, answer);
    }
  }());

  return {
    cached: false,
    provider: provider.name,
    model: provider.model,
    inputCostPerMillion: provider.inputCostPerMillion,
    outputCostPerMillion: provider.outputCostPerMillion,
    stream,
  };
}

export default chatWithAI;