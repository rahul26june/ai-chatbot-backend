import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { login, register } from "../src/controllers/auth.controller.js";
import { requireAuth } from "../src/middleware/require-auth.js";

const JWT_SECRET = "test-secret-with-more-than-thirty-two-characters";

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

before(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

describe("JWT authentication middleware", () => {
  it("rejects requests without a bearer token", () => {
    const response = createResponse();
    requireAuth({ get: () => undefined }, response, () => {
      assert.fail("next should not be called");
    });
    assert.equal(response.statusCode, 401);
  });

  it("attaches the subject for a valid bearer token", () => {
    const token = jwt.sign({}, JWT_SECRET, {
      subject: "user-123",
      expiresIn: "1h",
    });
    const request = { get: () => `Bearer ${token}` };
    const response = createResponse();
    let nextCalled = false;

    requireAuth(request, response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.deepEqual(request.auth, { userId: "user-123" });
  });

  it("rejects expired tokens", () => {
    const token = jwt.sign({}, JWT_SECRET, {
      subject: "user-123",
      expiresIn: -1,
    });
    const response = createResponse();

    requireAuth({ get: () => `Bearer ${token}` }, response, () => {
      assert.fail("next should not be called");
    });

    assert.equal(response.statusCode, 401);
  });
});

describe("authentication input validation", () => {
  it("rejects invalid registration input before database access", async () => {
    const response = createResponse();

    await register({
      body: { name: "Test", email: "not-an-email", password: "short" },
    }, response);

    assert.equal(response.statusCode, 400);
  });

  it("rejects invalid login input before database access", async () => {
    const response = createResponse();

    await login({ body: { email: "not-an-email", password: "" } }, response);

    assert.equal(response.statusCode, 400);
  });
});
