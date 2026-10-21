import mongoose from "mongoose";
import { logger } from "../observability/logger.js";

export async function connectDatabase() {
  const connectionString = process.env.MONGODB_URI;
  if (!connectionString) {
    throw new Error("MONGODB_URI is required to start the backend.");
  }

  const databaseName = process.env.MONGODB_DB || "ai-chatbot";
  await mongoose.connect(connectionString, { dbName: databaseName });
  logger.info("database.connected", { database: databaseName });
}
