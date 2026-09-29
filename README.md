<div align="center">

# Forja

### Self-hosted AI support for WhatsApp, Instagram, Messenger, Telegram, and web chat.

Forja is an open-source Cloudflare Worker that runs in your own account, uses your own AI key, and keeps customer data in your own D1, Vectorize, and R2 resources.

[Install](#install) · [How it works](#how-it-works) · [Admin dashboard](#admin-dashboard) · [Privacy](./PRIVACY.md)

</div>

## Features

- Multichannel support for WhatsApp, Instagram, Messenger, Telegram, and web chat.
- Retrieval-augmented generation (RAG) with Cloudflare Vectorize.
- Voice transcription and image understanding.
- Human handoff with tickets, owner takeover, and manual replies.
- Knowledge-base management from `/admin/kb`.
- Conversation inbox and analytics from `/admin`.
- Optional campaigns, follow-ups, Cal.com bookings, and lead capture.
- Provider selection for Anthropic, OpenAI, xAI, and Xiaomi MiMo.

## Install

Requirements: Node.js 18+, pnpm, and a Cloudflare account.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm run deploy
```

Configure the values in `wrangler.toml` and store secrets with Wrangler. Never commit API keys.

```bash
pnpm wrangler secret put MIMO_API_KEY
pnpm wrangler secret put DASHBOARD_PASSWORD
```

After deployment, open `/admin` and connect your channels from the Connections page.

## How it works

```mermaid
flowchart LR
  C[Customer channel] --> W[Cloudflare Worker]
  W --> A[Support Agent Durable Object]
  A --> V[(Vectorize knowledge base)]
  A --> L[AI provider]
  A --> D[(D1 conversations and leads)]
  A --> C
  W --> P[/admin dashboard]
```

An incoming message is normalized by its channel adapter, buffered by the agent, enriched with business context and Vectorize results, sent to the selected model, persisted in D1, and delivered back through the same channel.

## Admin dashboard

The dashboard includes:

- Conversations: live inbox, manual owner replies, bot pause/resume, and copilot suggestions.
- Knowledge: edit and re-index business documents.
- Connections: configure WhatsApp, Twilio, Telegram, Meta, and ManyChat.
- Leads and tickets: review captured leads and resolve human handoffs.
- Analytics: insights, statistics, AI costs, campaigns, and improvements.

Manual replies are sent through the conversation's channel adapter. For WhatsApp Cloud, Forja uses Meta's Graph API with `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`.

## Storage and privacy

The Worker stores data in your Cloudflare account. Messages are retained according to the cleanup cron configured in `wrangler.toml`; leads, tickets, and knowledge-base documents remain until you remove them. See [PRIVACY.md](./PRIVACY.md).

## Project structure

- `src/index.ts` — webhooks and HTTP routes.
- `src/agent.ts` — buffered Durable Object agent.
- `src/admin/` — server-rendered admin dashboard.
- `src/llm/` — model/provider selection, including MiMo.
- `src/kb/` — Vectorize indexing and search.
- `src/channels/` — channel adapters.
- `src/tools/` — tools exposed to the model.
- `test/` — Vitest test suite.

## License

MIT © Horizontes IA.
