import { GoogleGenAI } from "@google/genai";

export function createGeminiProvider({
  apiKey,
  model,
  inputCostPerMillion,
  outputCostPerMillion,
}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when AI_PROVIDER is gemini.");
  }

  const client = new GoogleGenAI({ apiKey });
  return {
    name: "gemini",
    model,
    inputCostPerMillion,
    outputCostPerMillion,
    async generateResponse(prompt) {
      const interaction = await client.interactions.create({
        model,
        input: prompt,
      });
      return {
        text: interaction.output_text,
        usage: interaction.usage,
      };
    },
    async *generateResponseStream(prompt, { signal } = {}) {
      const events = await client.interactions.create(
        {
          model,
          input: prompt,
          stream: true,
        },
        signal ? { fetchOptions: { signal } } : undefined,
      );

      for await (const event of events) {
        if (signal?.aborted) return;
        const text = extractTextDelta(event);
        if (text) yield { type: "text", text };
        const usage = extractUsage(event);
        if (usage) yield { type: "usage", usage };
      }
    },
  };
}

function extractUsage(event) {
  const usage = event?.metadata?.total_usage
    ?? event?.usage
    ?? event?.interaction?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = usage.total_input_tokens ?? usage.input_tokens;
  const outputTokens = usage.total_output_tokens ?? usage.output_tokens;
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
  };
}

export function extractTextDelta(event) {
  if (
    event?.event_type !== "step.delta"
    || event.delta?.type !== "text"
    || typeof event.delta.text !== "string"
  ) {
    return "";
  }
  return event.delta.text;
}
