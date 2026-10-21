import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import chatRoutes from "./routes/chat.routes.js";
import authRoutes from "./routes/auth.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import agentRoutes from "./routes/agent.routes.js";
import { connectDatabase } from "./config/database.js";
import { validateSecurityConfig } from "./config/security.js";
import { connectRedis } from "./config/redis.js";
import redisClient from "./config/redis.js";
import {
  getMetrics,
  httpMetricsMiddleware,
  httpRateLimitedTotal,
} from "./observability/metrics.js";
import { logException, logger } from "./observability/logger.js";
import {
  captureException,
  flushErrorMonitoring,
  initializeErrorMonitoring,
} from "./observability/error-monitoring.js";

function positiveInteger(value, fallback, setting) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  logger.warn("config.invalid_positive_integer", { setting, fallback });
  return fallback;
}

function parseTrustProxy(value) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  logger.warn("config.invalid_trust_proxy", { fallback: false });
  return false;
}

function createRateLimiter({ name, windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      httpRateLimitedTotal.inc({ limiter: name });
      logger.warn("http.rate_limited", {
        requestId: req.id,
        limiter: name,
        method: req.method,
        route: name,
      });
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
        requestId: req.id,
      });
    },
  });
}

export function createApp({ rateLimits = {} } = {}) {
  const app = express();
  app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

  app.use((req, res, next) => {
    req.id = randomUUID();
    req.startedAt = process.hrtime.bigint();
    res.setHeader("X-Request-Id", req.id);
    let logged = false;
    const logResponse = () => {
      if (logged) return;
      logged = true;
      const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
      logger.info("http.request", {
        requestId: req.id,
        method: req.method,
        route: req.route?.path
          ? `${req.baseUrl}${req.route.path}`
          : req.path.startsWith("/api/health")
            ? req.path
            : "unmatched",
        statusCode: res.writableFinished ? res.statusCode : 499,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    };
    res.once("finish", logResponse);
    res.once("close", logResponse);
    next();
  });
  app.use(httpMetricsMiddleware);
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health/live", (req, res) => {
    res.status(200).json({ status: "ok", requestId: req.id });
  });

  app.get("/api/health/ready", (req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = redisClient.isReady;
    const healthy = mongoReady && redisReady;
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "unavailable",
      requestId: req.id,
      dependencies: {
        mongo: mongoReady ? "connected" : "disconnected",
        redis: redisReady ? "connected" : "disconnected",
      },
    });
  });

  app.get("/api/health", (req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = redisClient.isReady;
    const healthy = mongoReady && redisReady;
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "unavailable",
      requestId: req.id,
      dependencies: {
        mongo: mongoReady ? "connected" : "disconnected",
        redis: redisReady ? "connected" : "disconnected",
      },
    });
  });

  app.get("/api/metrics", async (req, res, next) => {
    try {
      res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.end(await getMetrics());
    } catch (error) {
      next(error);
    }
  });

  const apiLimiter = createRateLimiter({
    name: "api",
    windowMs: positiveInteger(
      rateLimits.apiWindowMs ?? process.env.API_RATE_LIMIT_WINDOW_MS,
      60_000,
      "API_RATE_LIMIT_WINDOW_MS",
    ),
    limit: positiveInteger(
      rateLimits.apiMax ?? process.env.API_RATE_LIMIT_MAX,
      300,
      "API_RATE_LIMIT_MAX",
    ),
  });
  const authLimiter = createRateLimiter({
    name: "auth",
    windowMs: positiveInteger(
      rateLimits.authWindowMs ?? process.env.AUTH_RATE_LIMIT_WINDOW_MS,
      15 * 60_000,
      "AUTH_RATE_LIMIT_WINDOW_MS",
    ),
    limit: positiveInteger(
      rateLimits.authMax ?? process.env.AUTH_RATE_LIMIT_MAX,
      10,
      "AUTH_RATE_LIMIT_MAX",
    ),
  });
  const chatLimiter = createRateLimiter({
    name: "chat",
    windowMs: positiveInteger(
      rateLimits.chatWindowMs ?? process.env.CHAT_RATE_LIMIT_WINDOW_MS,
      60_000,
      "CHAT_RATE_LIMIT_WINDOW_MS",
    ),
    limit: positiveInteger(
      rateLimits.chatMax ?? process.env.CHAT_RATE_LIMIT_MAX,
      30,
      "CHAT_RATE_LIMIT_MAX",
    ),
  });
  const agentLimiter = createRateLimiter({
    name: "agent",
    windowMs: positiveInteger(
      rateLimits.agentWindowMs ?? process.env.AGENT_RATE_LIMIT_WINDOW_MS,
      60_000,
      "AGENT_RATE_LIMIT_WINDOW_MS",
    ),
    limit: positiveInteger(
      rateLimits.agentMax ?? process.env.AGENT_RATE_LIMIT_MAX,
      5,
      "AGENT_RATE_LIMIT_MAX",
    ),
  });

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/health") || req.path === "/metrics") return next();
    return apiLimiter(req, res, next);
  });
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/chat", chatLimiter, chatRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/agents", agentLimiter, agentRoutes);

  initializeErrorMonitoring(app);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: "Route was not found.",
      requestId: req.id,
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    logException("http.unhandled_error", error, {
      requestId: req.id,
      method: req.method,
      route: req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched",
    });
    captureException(error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "An unexpected error occurred.",
      requestId: req.id,
    });
  });

  return app;
}

export async function startServer() {
  validateSecurityConfig();
  await connectDatabase();
  await connectRedis();
  const app = createApp();
  const port = positiveInteger(process.env.PORT, 5000, "PORT");
  const server = app.listen(port, () => {
    logger.info("server.listening", { port });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("server.shutdown", { signal });
    server.close(async (error) => {
      if (error) {
        logException("server.shutdown_error", error);
        process.exitCode = 1;
      }
      if (redisClient.isOpen) await redisClient.quit();
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      await flushErrorMonitoring();
    });
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    logException("server.startup_failed", error);
    process.exitCode = 1;
  });
}
