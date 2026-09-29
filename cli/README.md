# forjabot CLI

Install and maintain self-hosted Forja AI bots from your terminal. The CLI downloads the bot template, preserves `member/` customizations, and helps deploy to the user's own Cloudflare account.

## Requirements

- Node.js 18+
- A Cloudflare account
- pnpm or `npx`
- An AI provider key, stored as a Cloudflare secret

## Commands

```bash
npx forjabot init
npx forjabot list
npx forjabot install <slug>
npx forjabot update [folder]
npx forjabot doctor [folder]
npx forjabot login
npx forjabot pair --url https://<worker>.workers.dev
```

`init` asks for the business profile, region, AI provider, and plan. English is the default region; Spanish, Portuguese, and additional locales remain available as explicit choices.

The CLI never receives or stores the AI provider key. Deployment stores it with Wrangler in the user's Cloudflare account.

## Safety

- No telemetry is collected by the CLI.
- Secrets are never printed or committed.
- `member/` is preserved during updates.
- Review the generated diff before deploying.

## License

MIT © Horizontes IA.
