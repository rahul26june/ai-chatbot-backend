import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApp } from "../src/server.js";
import {
  AGENT_SEQUENCE,
  createAgentWorkflowEngine,
} from "../src/services/agent-workflow.service.js";

const servers = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

function createHarness() {
  const records = new Map();
  const cache = new Map();
  let nextId = 1;
  const WorkflowModel = {
    async create(values) {
      const id = String(nextId++);
      const record = {
        ...values,
        _id: { toString: () => id },
        createdAt: new Date(),
        updatedAt: new Date(),
        async save() {
          this.updatedAt = new Date();
          records.set(this._id.toString(), this);
          return this;
        },
      };
      records.set(record._id.toString(), record);
      return record;
    },
    async findOne(filter) {
      const workflow = records.get(String(filter._id));
      return workflow?.user === filter.user ? workflow : null;
    },
    find(filter) {
      const workflows = [...records.values()]
        .filter(({ user }) => user === filter.user)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20);
      return {
        sort() {
          return this;
        },
        async limit() {
          return workflows;
        },
      };
    },
  };
  const redis = {
    async set(key, value, options) {
      cache.set(key, { value, options });
    },
    async get(key) {
      return cache.get(key)?.value ?? null;
    },
  };
  return {
    engine: createAgentWorkflowEngine({
      WorkflowModel,
      redis,
      log: { error() {}, warn() {} },
    }),
    records,
    cache,
  };
}

describe("agent workflow engine", () => {
  it("requires authentication for workflow creation and listing", async () => {
    const server = createApp().listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const [createResponse, listResponse] = await Promise.all([
      fetch(`${baseUrl}/api/agents/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "test task" }),
      }),
      fetch(`${baseUrl}/api/agents`),
    ]);

    assert.equal(createResponse.status, 401);
    assert.equal(listResponse.status, 401);
  });

  it("runs research, coding, review, and summary in sequence and persists progress", async () => {
    const { engine, records, cache } = createHarness();
    const prompts = [];
    const provider = {
      name: "openai",
      async generateResponse(prompt) {
        prompts.push(prompt);
        return {
          text: `stage ${prompts.length}`,
          provider: "openai",
          model: "test-model",
          inputCostPerMillion: 1,
          outputCostPerMillion: 2,
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        };
      },
    };

    const { workflow: accepted, completion } = await engine.start({
      userId: "user-1",
      task: "Design an example API",
      provider,
    });
    assert.equal(accepted.provider, "openai");

    const result = await completion;
    assert.equal(result.status, "completed");
    assert.equal(result.progress, 100);
    assert.deepEqual(result.steps.map(({ agent }) => agent), AGENT_SEQUENCE.map(({ id }) => id));
    assert.ok(result.steps.every(({ status }) => status === "completed"));
    assert.equal(result.steps[3].output, "stage 4");
    assert.equal(result.steps[0].inputTokens, 100);
    assert.equal(result.steps[0].outputTokens, 50);
    assert.equal(result.steps[0].estimatedCostUsd, 0.0002);
    assert.equal(result.steps[0].model, "test-model");
    assert.match(prompts[1], /stage 1/);
    assert.match(prompts[2], /stage 2/);
    assert.match(prompts[3], /stage 3/);
    assert.match(prompts[1], /do not claim to edit files/i);

    const stored = records.get(accepted.id);
    assert.equal(stored.status, "completed");
    assert.equal(cache.get(`agent-workflow:user-1:${accepted.id}`).options.EX, 86_400);
    assert.equal((await engine.get("user-1", accepted.id)).status, "completed");
    assert.equal(await engine.get("another-user", accepted.id), null);
    assert.equal((await engine.list("user-1"))[0].steps[0].status, "completed");
    assert.equal("output" in (await engine.list("user-1"))[0].steps[0], false);
  });

  it("records a failed stage without leaking provider error details", async () => {
    const { engine } = createHarness();
    const { workflow, completion } = await engine.start({
      userId: "user-2",
      task: "Handle an unavailable provider",
      provider: {
        name: "gemini",
        async generateResponse() {
          throw new Error("provider details must not be exposed");
        },
      },
    });

    const result = await completion;
    assert.equal(result.status, "failed");
    assert.equal(result.currentAgent, null);
    assert.equal(result.steps[0].status, "failed");
    assert.equal(result.error, "An agent stage failed. Please retry the workflow.");
    assert.equal(JSON.stringify(result).includes("provider details"), false);
  });
});
