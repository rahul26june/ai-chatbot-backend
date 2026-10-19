import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import chatRoutes from "../src/routes/chat.routes.js";

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRoutes);
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

describe("protected chat route", () => {
  it("rejects requests without a JWT before calling the AI service", async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    const streamResponse = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Authentication is required.",
    });
    assert.equal(streamResponse.status, 401);
    assert.deepEqual(await streamResponse.json(), {
      success: false,
      error: "Authentication is required.",
    });
  });
});
