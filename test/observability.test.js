import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApp } from "../src/server.js";
import { metricsRegistry } from "../src/observability/metrics.js";

const servers = [];

async function startApp(options) {
  const server = createApp(options).listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

describe("backend observability and security middleware", () => {
  it("adds request IDs and security headers and exposes Prometheus metrics", async () => {
    const baseUrl = await startApp();
    const liveResponse = await fetch(`${baseUrl}/api/health/live`);

    assert.equal(liveResponse.status, 200);
    assert.match(liveResponse.headers.get("x-request-id"), /^[\da-f-]{36}$/i);
    assert.equal(liveResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await liveResponse.json()).status, "ok");

    const metricsResponse = await fetch(`${baseUrl}/api/metrics`);
    const metrics = await metricsResponse.text();
    assert.equal(metricsResponse.status, 200);
    assert.match(metricsResponse.headers.get("content-type"), /text\/plain/);
    assert.match(metrics, /ai_chatbot_http_requests_total/);
    assert.match(metrics, /ai_chatbot_process_cpu_user_seconds_total/);
  });

  it("enforces the configured general API rate limit and returns request IDs", async () => {
    const baseUrl = await startApp({
      rateLimits: { apiMax: 1, apiWindowMs: 60_000 },
    });
    const firstResponse = await fetch(`${baseUrl}/api/not-a-route`);
    const limitedResponse = await fetch(`${baseUrl}/api/not-a-route`);

    assert.equal(firstResponse.status, 404);
    assert.equal(limitedResponse.status, 429);
    assert.ok(limitedResponse.headers.get("x-request-id"));
    assert.equal((await limitedResponse.json()).error, "Too many requests. Please try again later.");

    const exposition = await metricsRegistry.metrics();
    assert.match(exposition, /ai_chatbot_http_rate_limited_total\{[^}]*limiter="api"/);
  });
});
