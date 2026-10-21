import { createAnthropicProvider } from "./anthropic.provider.js";
import { createGeminiProvider } from "./gemini.provider.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.provider.js";
import { logger } from "../observability/logger.js";

const PROVIDERS = {
  gemini: {
    defaultModel: "gemini-3.8-flash",
    apiKeyName: "GEMINI_API_KEY",
    inputRateName: "GEMINI_INPUT_COST_PER_MILLION",
    outputRateName: "GEMINI_OUTPUT_COST_PER_MILLION",
    create: createGeminiProvider,
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    apiKeyName: "OPENAI_API_KEY",
    inputRateName: "OPENAI_INPUT_COST_PER_MILLION",
    outputRateName: "OPENAI_OUTPUT_COST_PER_MILLION",
    create: (options) => createOpenAICompatibleProvider({
      ...options,
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
    }),
  },
  deepseek: {
    defaultModel: "deepseek-chat",
    apiKeyName: "DEEPSEEK_API_KEY",
    inputRateName: "DEEPSEEK_INPUT_COST_PER_MILLION",
    outputRateName: "DEEPSEEK_OUTPUT_COST_PER_MILLION",
    create: (options) => createOpenAICompatibleProvider({
      ...options,
      name: "deepseek",
      baseUrl: "https://api.deepseek.com",
    }),
  },
  claude: {
    defaultModel: "claude-sonnet-4-5",
    apiKeyName: "ANTHROPIC_API_KEY",
    inputRateName: "CLAUDE_INPUT_COST_PER_MILLION",
    outputRateName: "CLAUDE_OUTPUT_COST_PER_MILLION",
    create: createAnthropicProvider,
  },
};

function parseRate(value, settingName) {
  if (value === undefined || value === "") return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`${settingName} must be a non-negative number.`);
  }
  return rate;
}

function createSingleProvider(name, env) {
  const providerName = name.toLowerCase();
  const definition = PROVIDERS[providerName];
  if (!definition) {
    throw new Error(
      `Unsupported AI_PROVIDER "${providerName}". Choose gemini, openai, deepseek, or claude.`,
    );
  }

  const apiKey = env[definition.apiKeyName];
  if (!apiKey) {
    throw new Error(`${definition.apiKeyName} is required when AI_PROVIDER is ${providerName}.`);
  }

  const model = env.AI_MODEL || env[`${providerName.toUpperCase()}_MODEL`] || definition.defaultModel;
  return definition.create({
    apiKey,
    model,
    inputCostPerMillion: parseRate(
      env[definition.inputRateName],
      definition.inputRateName,
    ),
    outputCostPerMillion: parseRate(
      env[definition.outputRateName],
      definition.outputRateName,
    ),
  });
}

async function* prependEvents(events, iterator) {
  yield* events;
  while (true) {
    const result = await iterator.next();
    if (result.done) return;
    yield result.value;
  }
}

export function createProviderManager(providers, { onFallback = (event) => logger.warn(event) } = {}) {
  if (!providers.length) {
    throw new Error("At least one AI provider must be configured.");
  }
  const [primary] = providers;

  async function openProviderStream(provider, prompt, options) {
    const iterator = provider.generateResponseStream(prompt, options)[Symbol.asyncIterator]();
    const initialEvents = [];
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          return {
            provider,
            stream: prependEvents(initialEvents, iterator),
          };
        }
        initialEvents.push(result.value);
        if (result.value?.type === "text" && result.value.text) {
          return {
            provider,
            stream: prependEvents(initialEvents, iterator),
          };
        }
      }
    } catch (error) {
      await iterator.return?.();
      throw error;
    }
  }

  return {
    ...primary,
    providers: providers.map(({ name, model }) => ({ name, model })),
    async generateResponse(prompt, options) {
      let lastError;
      for (const [index, provider] of providers.entries()) {
        try {
          const result = await provider.generateResponse(prompt, options);
          return {
            ...(typeof result === "string" ? { text: result } : result),
            provider: provider.name,
            model: provider.model,
            inputCostPerMillion: provider.inputCostPerMillion,
            outputCostPerMillion: provider.outputCostPerMillion,
          };
        } catch (error) {
          lastError = error;
          onFallback(JSON.stringify({
            event: index === providers.length - 1
              ? "ai.provider.exhausted"
              : "ai.provider.fallback",
            provider: provider.name,
            model: provider.model,
            nextProvider: providers[index + 1]?.name ?? null,
            errorName: error.name,
          }));
        }
      }
      throw lastError;
    },
    async openResponseStream(prompt, options) {
      let lastError;
      for (const [index, provider] of providers.entries()) {
        try {
          const opened = await openProviderStream(provider, prompt, options);
          return {
            ...opened,
            providers: providers.map(({ name, model }) => ({ name, model })),
          };
        } catch (error) {
          lastError = error;
          onFallback(JSON.stringify({
            event: index === providers.length - 1
              ? "ai.provider.exhausted"
              : "ai.provider.fallback",
            provider: provider.name,
            model: provider.model,
            nextProvider: providers[index + 1]?.name ?? null,
            errorName: error.name,
          }));
        }
      }
      throw lastError;
    },
  };
}

export function createProvider(name, env = process.env) {
  const providerNames = [
    name,
    ...(env.AI_PROVIDER_FALLBACKS || "")
      .split(",")
      .map((providerName) => providerName.trim().toLowerCase())
      .filter(Boolean),
  ];
  const uniqueProviderNames = [...new Set(providerNames.map((providerName) => providerName.toLowerCase()))];
  const providers = uniqueProviderNames.map((providerName) => (
    createSingleProvider(providerName, env)
  ));
  return createProviderManager(providers);
}

export const supportedProviders = Object.freeze(Object.keys(PROVIDERS));
