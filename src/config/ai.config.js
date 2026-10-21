import "dotenv/config";
import { createProvider } from "../providers/provider.factory.js";
import { logger } from "../observability/logger.js";

const providerName = (process.env.AI_PROVIDER || "gemini").toLowerCase();

const aiProvider = createProvider(providerName);

export function getAiProvider(name = providerName) {
  const normalizedName = name.toLowerCase();
  return normalizedName === aiProvider.name
    ? aiProvider
    : createProvider(normalizedName);
}

logger.info("ai.provider.configured", {
  provider: aiProvider.name,
  model: aiProvider.model,
  fallbacks: aiProvider.providers?.slice(1) ?? [],
});

export default aiProvider;
