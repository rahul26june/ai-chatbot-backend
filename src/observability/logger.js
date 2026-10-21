import winston from "winston";

const { combine, errors, json, timestamp } = winston.format;

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json(),
  ),
  defaultMeta: { service: "ai-chatbot-backend" },
  transports: [new winston.transports.Console()],
});

export function logException(event, error, metadata = {}) {
  logger.error(event, {
    ...metadata,
    error: {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
      stack: error?.stack,
    },
  });
}
