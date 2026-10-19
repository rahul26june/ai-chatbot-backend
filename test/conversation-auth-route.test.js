import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import conversationRoutes from "../src/routes/conversation.routes.js";

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", conversationRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("protected conversation routes", () => {
  it("requires authentication before listing, creating, loading, or deleting", async () => {
    const requests = [
      fetch(`${baseUrl}/api/conversations`),
      fetch(`${baseUrl}/api/conversations`, { method: "POST" }),
      fetch(`${baseUrl}/api/conversations/507f1f77bcf86cd799439011`),
      fetch(`${baseUrl}/api/conversations/507f1f77bcf86cd799439011`, {
        method: "DELETE",
      }),
    ];

    for (const response of await Promise.all(requests)) {
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false,
        error: "Authentication is required.",
      });
    }
  });
});
