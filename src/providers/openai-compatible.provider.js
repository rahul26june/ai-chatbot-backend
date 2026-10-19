async function* readSseEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
      }
      if (done || signal?.aborted) break;
    }
    if (buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens;
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
  };
}

async function assertResponse(response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const message = body.error?.message ?? body.message ?? `Provider request failed (${response.status}).`;
  throw new Error(message);
}

export function createOpenAICompatibleProvider({
  name,
  apiKey,
  model,
  baseUrl,
  inputCostPerMillion,
  outputCostPerMillion,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error(`${name.toUpperCase()}_API_KEY is required when AI_PROVIDER is ${name}.`);
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    name,
    model,
    inputCostPerMillion,
    outputCostPerMillion,
    async generateResponse(prompt, { signal } = {}) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      await assertResponse(response);
      const result = await response.json();
      return {
        text: result.choices?.[0]?.message?.content ?? "",
        usage: normalizeUsage(result.usage),
      };
    },
    async *generateResponseStream(prompt, { signal } = {}) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
      await assertResponse(response);
      if (!response.body) throw new Error(`${name} returned no streaming response body.`);

      for await (const event of readSseEvents(response, signal)) {
        if (signal?.aborted) return;
        const text = event.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield { type: "text", text };
        const usage = normalizeUsage(event.usage);
        if (usage) yield { type: "usage", usage };
      }
    },
  };
}

export { normalizeUsage as normalizeOpenAIUsage };
