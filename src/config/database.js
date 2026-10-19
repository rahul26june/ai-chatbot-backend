import mongoose from "mongoose";

export async function connectDatabase() {
  const connectionString = process.env.MONGODB_URI;
  if (!connectionString) {
    throw new Error("MONGODB_URI is required to start the backend.");
  }

  const databaseName = process.env.MONGODB_DB || "ai-chatbot";
  await mongoose.connect(connectionString, { dbName: databaseName });
  console.log(`Connected to MongoDB database "${databaseName}".`);
}
