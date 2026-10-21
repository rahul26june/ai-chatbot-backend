import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: "ai-chatbot-backend" });
collectDefaultMetrics({ register: metricsRegistry, prefix: "ai_chatbot_" });

export const httpRequestsTotal = new Counter({
  name: "ai_chatbot_http_requests_total",
  help: "Total number of HTTP requests handled.",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "ai_chatbot_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const httpRequestsInFlight = new Gauge({
  name: "ai_chatbot_http_requests_in_flight",
  help: "Number of HTTP requests currently being handled.",
  registers: [metricsRegistry],
});

export const httpRateLimitedTotal = new Counter({
  name: "ai_chatbot_http_rate_limited_total",
  help: "Total number of requests rejected by rate limiting.",
  labelNames: ["limiter"],
  registers: [metricsRegistry],
});

export const streamRequestsTotal = new Counter({
  name: "ai_chatbot_stream_requests_total",
  help: "Total number of AI stream requests.",
  labelNames: ["provider", "model", "result", "cached"],
  registers: [metricsRegistry],
});

export const providerTokensTotal = new Counter({
  name: "ai_chatbot_provider_tokens_total",
  help: "Provider-reported tokens by direction.",
  labelNames: ["provider", "model", "direction"],
  registers: [metricsRegistry],
});

export const estimatedCostUsdTotal = new Counter({
  name: "ai_chatbot_estimated_cost_usd_total",
  help: "Estimated provider cost in USD; populated only when token rates are configured.",
  labelNames: ["provider", "model"],
  registers: [metricsRegistry],
});

export const httpMetricsMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  httpRequestsInFlight.inc();
  let recorded = false;
  const recordResponse = () => {
    if (recorded) return;
    recorded = true;
    httpRequestsInFlight.dec();
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.path.startsWith("/api/health")
        ? req.path
        : "unmatched";
    const statusCode = res.writableFinished ? res.statusCode : 499;
    const labels = {
      method: req.method,
      route,
      status_code: String(statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  };
  res.once("finish", recordResponse);
  res.once("close", recordResponse);
  next();
};

export function recordStreamMetrics({
  provider = "unknown",
  model = "unknown",
  result,
  cached = false,
  usage,
  estimatedCostUsd,
}) {
  const labels = {
    provider: provider || "unknown",
    model: model || "unknown",
    result,
    cached: String(cached),
  };
  streamRequestsTotal.inc(labels);
  recordProviderUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    usage,
    estimatedCostUsd,
  });
}

export function recordProviderUsage({
  provider = "unknown",
  model = "unknown",
  usage,
  estimatedCostUsd,
}) {
  provider ||= "unknown";
  model ||= "unknown";
  if (usage?.inputTokens > 0) {
    providerTokensTotal.inc({ provider, model, direction: "input" }, usage.inputTokens);
  }
  if (usage?.outputTokens > 0) {
    providerTokensTotal.inc({ provider, model, direction: "output" }, usage.outputTokens);
  }
  if (Number.isFinite(estimatedCostUsd) && estimatedCostUsd >= 0) {
    estimatedCostUsdTotal.inc({ provider, model }, estimatedCostUsd);
  }
}

export async function getMetrics() {
  return metricsRegistry.metrics();
}
