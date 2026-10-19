import assert from "node:assert/strict";
import mongoose from "mongoose";
import { describe, it } from "node:test";
import Conversation from "../src/models/conversation.model.js";

describe("conversation and message schemas", () => {
  it("stores messages on an owned conversation", async () => {
    const conversation = new Conversation({
      user: new mongoose.Types.ObjectId(),
      messages: [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "Hi there" },
      ],
    });

    await conversation.validate();
    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.messages[0].role, "user");
    assert.equal(conversation.messages[1].role, "assistant");
  });

  it("rejects unsupported message roles", async () => {
    const conversation = new Conversation({
      user: new mongoose.Types.ObjectId(),
      messages: [{ role: "system", text: "Do not store this role" }],
    });

    await assert.rejects(
      conversation.validate(),
      (error) => error.errors["messages.0.role"].kind === "enum",
    );
  });
});
