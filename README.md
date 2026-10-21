# AI Chat backend

## Configuration

Copy `.env.example` to `.env` and set:

- `MONGODB_URI` to your MongoDB connection string.
- `MONGODB_DB` to the database name (defaults to `ai-chatbot`).
- `JWT_SECRET` to a private random value of at least 32 characters.
- The API key for the selected `AI_PROVIDER`: `GEMINI_API_KEY`,
  `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or `ANTHROPIC_API_KEY`.
- `REDIS_URL` to your Redis connection string (defaults to `redis://localhost:6379`).
- `AI_PROVIDER` to `gemini` (default), `openai`, `deepseek`, or `claude`.
- `AI_MODEL` to override the provider's default model, or use
  `GEMINI_MODEL`, `OPENAI_MODEL`, `DEEPSEEK_MODEL`, or `CLAUDE_MODEL`.
- Optional provider-specific `*_INPUT_COST_PER_MILLION` and
  `*_OUTPUT_COST_PER_MILLION` rates in USD for estimated cost tracking.
- `PORT` if you do not want to use port 5000.

Keep `.env` private; it is excluded from source control.

## Run locally

```sh
npm install
npm run dev
```

Start Redis in Docker from the repository root before starting the backend:

```sh
docker compose up -d redis
```

The Redis port is exposed only on localhost, matching the default
`REDIS_URL=redis://localhost:6379`. Stop Redis with `docker compose stop redis`.

## Run the full stack in Docker

Copy `ai-chatbot-backend/.env.example` to `ai-chatbot-backend/.env`, configure
the JWT secret and at least one AI provider API key, then run from the
repository root:

```sh
docker compose up --build -d
docker compose ps
```

Open `http://localhost:3000`. The frontend Nginx container proxies `/api`
requests to the backend and disables response buffering for SSE. MongoDB and
Redis data use named volumes. Local MongoDB and Redis ports are bound to
`127.0.0.1`; this Compose stack is intended for local development, not as-is for
public production deployment. MongoDB is only exposed on the internal Compose
network; Redis is bound to localhost. Check readiness with `GET /api/health` or
`docker compose ps`; stop the stack with `docker compose down` (data volumes
remain) and remove persisted data only with `docker compose down -v`.

## API

- `POST /api/auth/register` with `{ "name", "email", "password" }`
- `POST /api/auth/login` with `{ "email", "password" }`
- `POST /api/chat` with `{ "message", "conversationId" }`
- `POST /api/chat/stream` with `{ "message", "history", "conversationId" }`
  streams chat events as Server-Sent Events (`meta`, `delta`, `done`, or
  `error`). Disconnecting the request stops generation; any generated partial
  response is saved to the conversation.
- `POST /api/conversations` creates an empty conversation.
- `GET /api/conversations?q=<search>` lists a user's conversations and searches
  titles and message content.
- `GET /api/conversations/:id` loads one conversation and its messages.
- `DELETE /api/conversations/:id` deletes one of the authenticated user's
  conversations.
- `POST /api/agents/workflows` starts an agent workflow with
  `{ "task": "..." }`; optionally pass a configured `provider` (`gemini`,
  `openai`, `deepseek`, or `claude`). It returns `202` with a workflow ID and
  initial progress.
- `GET /api/agents/workflows/:id` returns workflow status, per-agent progress,
  and completed outputs. Poll this endpoint while the workflow is running.
- `GET /api/agents` lists the authenticated user's latest 20 workflow summaries.

Chat and conversation routes require an `Authorization: Bearer <token>` header.
Registration and login return a signed JWT and the public user profile.
Passwords are hashed before storage. Conversations and messages are persisted in
MongoDB and scoped to their owner. The browser also caches conversation data in
local storage.

## AI providers

The provider factory selects a shared provider interface using `AI_PROVIDER`.
Gemini uses the Google GenAI SDK; OpenAI and DeepSeek use their compatible chat
completion APIs; Claude uses the Anthropic Messages API. All providers support
streaming and non-streaming generation. Provider keys are only read by the
backend and must not be added to the frontend environment.

The default model can be changed with `AI_MODEL`, or individually with
`GEMINI_MODEL`, `OPENAI_MODEL`, `DEEPSEEK_MODEL`, and `CLAUDE_MODEL`. Check the
provider's current model catalog before overriding defaults.

Optionally configure `AI_PROVIDER_FALLBACKS` as a comma-separated ordered list
of providers, for example `openai,deepseek`. Each configured fallback must
have its API key set. Non-streaming calls retry the next provider on errors;
streaming can fall back only before emitting the first text chunk, because
switching providers after text was sent would corrupt the response. Fallbacks
and the selected provider/model are logged without API keys.

Usage metrics are logged from provider-reported token counts. Estimated USD
cost is logged only when both input and output per-million-token rates are
configured for the selected provider; otherwise cost is `null`. Keep those
rates current with the provider's published pricing. Cached responses do not
incur a new provider usage charge and report no token usage.

For example, select OpenAI by setting `AI_PROVIDER=openai`,
`OPENAI_API_KEY`, and optionally `OPENAI_MODEL`. Claude uses
`AI_PROVIDER=claude` and `ANTHROPIC_API_KEY`; DeepSeek uses
`AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY`.

AI responses, unfiltered conversation lists, and individual conversations are
cached in Redis for one hour. Conversation caches are scoped to their owner and
invalidated when a conversation is created, updated through chat, or deleted.
Search-filtered conversation lists bypass the cache. Redis must be running and
reachable at `REDIS_URL` before the backend starts.

The web client consumes `/api/chat/stream` with `fetch()` and displays text as
it arrives. Stream logs include request IDs, cache status, output length,
time-to-first-token, and total duration; prompt and response text are not logged.

## Monitoring and security

Backend logs are structured JSON via Winston and include a generated
`X-Request-Id` for correlating each request. Optional Sentry error reporting is
enabled by setting `SENTRY_DSN`; PII collection is disabled. Health endpoints
are available at `/api/health/live` and `/api/health/ready` (`/api/health`
remains an alias for readiness).

Prometheus metrics are exposed at `/api/metrics` for internal scraping. The
frontend Nginx proxy returns 404 for this path so metrics are not exposed
through the public frontend. Prometheus scrapes the backend every 15 seconds;
Grafana is provisioned with the AI Chatbot Operations dashboard. In local
Compose, open Grafana at `http://localhost:3001` (default login `admin` /
`admin`, then change the password immediately) and Prometheus at
`http://localhost:9090`. These ports bind only to loopback. For the release
Compose stack, set a strong `GRAFANA_ADMIN_PASSWORD` in the server `.env` and
reach Grafana through a secure SSH tunnel or TLS reverse proxy.

Helmet adds standard security response headers. Rate limits are configurable
with `API_RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, and `CHAT_RATE_LIMIT_*` settings;
defaults are 300 API requests/minute, 10 auth requests/15 minutes, and 30 chat
requests/minute per client IP. Agent starts are separately limited by
`AGENT_RATE_LIMIT_*` (default: five per minute per client IP). Set `TRUST_PROXY`
only to the number of trusted proxies in front of the backend.

## Agent workflows

An authenticated workflow runs the Research, Coding, Review, and Summary
agents sequentially using the selected provider's existing adapter and fallback
chain. The research stage uses the model's supplied knowledge and task context;
it does not browse the web. The Coding Agent returns suggestions and code in
the workflow response only: it does not edit workspace files or execute code.
Review and summary stages receive the earlier outputs as context.

Workflow records, step outputs, and progress are saved to MongoDB. Redis keeps
a 24-hour, owner-scoped progress snapshot; the API verifies ownership in
MongoDB before returning it. Failed stages expose a generic error to the
caller, while logs identify the workflow and agent without logging task text,
generated code, or provider error messages. Workflow task/output content is
persisted as user data in MongoDB; secure and back up that database accordingly.
