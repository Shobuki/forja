# Privacy

Forja is self-hosted software. It runs in the installer's Cloudflare account with the installer's own credentials. Horizontes IA does not receive or store customer conversations by default.

## Data stored by the bot

Data is stored in the installer's Cloudflare D1, Vectorize, and R2 resources:

| Data | Storage | Retention |
| --- | --- | --- |
| Conversation messages | D1 `messages` | 90 days by the daily cleanup cron |
| Conversations | D1 `conversations` | Until deleted or cleaned up |
| Captured leads | D1 `leads` | Until deleted |
| Support tickets | D1 `tickets` | Until deleted |
| Customer facts and insights | D1 tables | Until deleted |
| Knowledge-base documents | D1 + Vectorize | Until deleted |

Forja does not permanently store incoming audio or images; it transcribes or analyzes them and persists the resulting text or metadata needed by the application.

## Third-party processing

Conversation text is sent to the selected AI provider using the installer's API key. Channel providers such as WhatsApp, Twilio, Meta, Telegram, ManyChat, and Cal.com process data under their own policies. Review those policies before handling sensitive information.

## Operator responsibilities

- Tell customers that they are interacting with an AI assistant.
- Publish an appropriate privacy notice and retention policy.
- Protect `/admin` with a strong `DASHBOARD_PASSWORD`.
- Do not upload sensitive information to the knowledge base unless your legal basis and provider terms allow it.
- Honor deletion requests and local privacy laws.

## Optional control-plane API

The `/api/*` control-plane endpoints are disabled unless `CONTROL_PLANE_TOKEN` is configured. When enabled, they expose aggregate operational metrics, not conversation content.

## Contact

Forja is provided under the MIT license without warranties. The operator is responsible for the data and legal compliance of each deployment.
