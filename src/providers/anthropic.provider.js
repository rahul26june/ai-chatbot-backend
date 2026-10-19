async function* readSseEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  let eventName = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      streamDone = done;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const event = JSON.parse(line.slice(5).trimStart());
          const type = event.type ?? eventName;
          if (type === "content_block_delta" && event.delta?.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          } else if (type === "message_start" && event.message?.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: event.message.usage.input_tokens ?? null,
                outputTokens: event.message.usage.output_tokens ?? null,
              },
            };
          } else if (type === "message_delta" && event.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: event.usage.input_tokens ?? null,
                outputTokens: event.usage.output_tokens ?? null,
              },
            };
          } else if (type === "error") {
            throw new Error(event.error?.message ?? "Anthropic stream failed.");
          }
          eventName = "";
        }
      }
      if (done || signal?.aborted) break;
    }
    if (streamDone && buffer.trim().startsWith("data:")) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        const event = JSON.parse(data);
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        } else if (event.type === "message_delta" && event.usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: event.usage.input_tokens ?? null,
              outputTokens: event.usage.output_tokens ?? null,
            },
          };
        } else if (event.type === "error") {
          throw new Error(event.error?.message ?? "Anthropic stream failed.");
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function assertResponse(response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(
    body.error?.message ?? `Anthropic request failed (${response.status}).`,
  );
}

export function createAnthropicProvider({
  apiKey,
  model,
  inputCostPerMillion,
  outputCostPerMillion,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER is claude.");
  }

  const endpoint = "https://api.anthropic.com/v1/messages";
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  return {
    name: "claude",
    model,
    inputCostPerMillion,
    outputCostPerMillion,
    async generateResponse(prompt, { signal } = {}) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      await assertResponse(response);
      const result = await response.json();
      return {
        text: result.content?.filter((part) => part.type === "text")
          .map((part) => part.text).join("") ?? "",
        usage: result.usage
          ? {
              inputTokens: result.usage.input_tokens ?? null,
              outputTokens: result.usage.output_tokens ?? null,
            }
          : null,
      };
    },
    async *generateResponseStream(prompt, { signal } = {}) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal,
        headers: { ...headers, Accept: "text/event-stream" },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });
      await assertResponse(response);
      if (!response.body) throw new Error("Anthropic returned no streaming response body.");
      yield* readSseEvents(response, signal);
    },
  };
}
