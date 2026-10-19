import "dotenv/config";
import { createProvider } from "../providers/provider.factory.js";

const providerName = (process.env.AI_PROVIDER || "gemini").toLowerCase();

const aiProvider = createProvider(providerName);

console.info(JSON.stringify({
  event: "ai.provider.configured",
  provider: aiProvider.name,
  model: aiProvider.model,
  fallbacks: aiProvider.providers?.slice(1) ?? [],
}));

export default aiProvider;
