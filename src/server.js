import express from "express";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js";
import authRoutes from "./routes/auth.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import { connectDatabase } from "./config/database.js";
import { validateSecurityConfig } from "./config/security.js";
import { connectRedis } from "./config/redis.js";
import redisClient from "./config/redis.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  const redisReady = redisClient.isReady;
  const healthy = mongoReady && redisReady;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "unavailable",
    dependencies: {
      mongo: mongoReady ? "connected" : "disconnected",
      redis: redisReady ? "connected" : "disconnected",
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/conversations", conversationRoutes);

const PORT = process.env.PORT || 5000;

validateSecurityConfig();
await connectDatabase();
await connectRedis();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
