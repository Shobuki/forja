# Forja — development instructions

Forja is an open-source Cloudflare Worker chatbot built with Hono, the Vercel AI SDK, D1, Vectorize, R2, and Durable Objects. The admin dashboard is mounted at `/admin`.

## Working rules

- Use English for code comments, UI copy, prompts, documentation, and generated messages.
- Preserve the existing API, database schema, channel identifiers, and environment variable names unless the task explicitly changes them.
- Never commit tokens or API keys. Use `wrangler secret put`.
- Treat `member/` as user-owned configuration. Preserve it during updates.
- Run `pnpm typecheck` and `pnpm test` before deployment when source code changes.
- Do not deploy, commit, or push without explicit approval.

## Important files

- `src/index.ts` — webhooks and HTTP routes.
- `src/agent.ts` — buffered SupportAgent Durable Object.
- `src/system-prompt.ts` — generated agent prompt.
- `src/llm/provider.ts` — Anthropic, OpenAI, xAI, and MiMo provider selection.
- `src/admin/` — admin dashboard views and routes.
- `src/channels/` — WhatsApp, Twilio, Telegram, Meta, and ManyChat adapters.
- `src/kb/` — knowledge-base indexing and Vectorize search.
- `test/` — Vitest tests.

## Deployment

Install dependencies with `pnpm install`, configure `wrangler.toml`, store secrets with Wrangler, and deploy with `pnpm run deploy` only after approval.
