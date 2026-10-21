import "dotenv/config";
import { createClient } from "redis";
import { logException, logger } from "../observability/logger.js";

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (err) => {
  logException("redis.client_error", err);
});

export async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  logger.info("redis.connected");
}

export default redisClient;