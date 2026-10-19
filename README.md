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
