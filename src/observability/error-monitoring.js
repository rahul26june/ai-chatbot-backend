import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

let initialized = false;

export function initializeErrorMonitoring(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("error_monitoring.disabled", {
      reason: "SENTRY_DSN is not configured",
    });
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  Sentry.setupExpressErrorHandler(app);
  initialized = true;
  logger.info("error_monitoring.enabled", {
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  });
  return true;
}

export function captureException(error, metadata = {}) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(metadata)) {
      scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

export async function flushErrorMonitoring(timeoutMs = 2000) {
  if (initialized) await Sentry.flush(timeoutMs);
}
