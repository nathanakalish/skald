# Skald

Skald is a self-hosted AI chat and roleplay app. It runs on your own machine or server, stores everything in a local SQLite database, and connects to whatever LLM providers you configure.

## Getting Started

Docker is the intended deployment method. Copy the `docker-compose.yml` from this repo, configure the environment variables (OIDC at minimum), and run:

```sh
docker compose up -d
```

Skald will be available at `http://localhost:3000`.

### Authentication

Skald uses OIDC for all authentication. You'll need an identity provider — [Authentik](https://goauthentik.io/), [Keycloak](https://www.keycloak.org/), [Authelia](https://www.authelia.com/), or any other OIDC-compliant IdP works. Configure it via the environment variables in `docker-compose.yml`:

```yaml
- OIDC_ISSUER_URL=https://auth.example.com
- OIDC_CLIENT_ID=skald
- OIDC_CLIENT_SECRET=your-secret
- OIDC_SCOPES=openid profile groups
- OIDC_USERNAME_CLAIM=preferred_username
- OIDC_ADMIN_GROUP=skald_admin
- OIDC_USER_GROUP=skald_user
- OIDC_AUTO_CREATE_USERS=true
```
Roles are assigned via group claims — `OIDC_ADMIN_GROUP` members get admin, `OIDC_USER_GROUP` members get user access.
### Persistent Data

Two volumes are created automatically:

| Volume | Container path | Contents |
|---|---|---|
| `skald-data` | `/app/data` | SQLite database, backups, image cache |
| `skald-avatars` | `/app/static/avatars` | Uploaded and imported avatar images |

### Local Providers (Ollama, etc.)

Provider endpoints are checked against a DNS blocklist by default to prevent SSRF. If you're running Ollama or another local LLM on the same machine or network, set:

```yaml
- ALLOW_LOCAL_PROVIDERS=true
```

### Other Environment Variables

See the comments in `docker-compose.yml` for the full list, including:

- `BACKUP_ENABLED` / `BACKUP_INTERVAL_HOURS` / `BACKUP_RETENTION` — periodic SQLite backups
- `BODY_SIZE_LIMIT` — raise for large character card imports
- `IMAGE_CACHE_MAX_BYTES` — cap on the image cache LRU (default 1 GiB)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — web push notifications. Generate a pair with `npx web-push generate-vapid-keys`; push is disabled if either key is missing.
- `LOG_LEVEL` — trace, debug, info (default), warn, error

### Logs

Logs are written as one JSON object per line to **stderr**. Each HTTP request is assigned a UUID, exposed both in every log line for that request and as the `x-request-id` response header, so users can quote it in bug reports.

```
LOG_LEVEL=info     # default — quiet, lifecycle events only
LOG_LEVEL=debug    # investigating — adds decisions, cache hits, queue moves
LOG_LEVEL=trace    # deep dive — per-token streaming, per-event SSE, per-query DB
LOG_LEVEL=warn     # only handled failures and security guard rejections
LOG_LEVEL=error    # only fatal/unhandled errors
```

Filter live with `jq`:

```bash
docker logs -f skald 2>&1 | jq 'select(.level=="warn" or .level=="error")'
docker logs skald 2>&1 | jq 'select(.requestId=="<paste-from-x-request-id-header>")'
```

Sensitive fields (`password`, `apiKey`, `authorization`, `cookie`, OIDC tokens, push subscription keys, …) are auto-redacted from log output regardless of the level.

## Features

### LLM Providers

Skald supports OpenAI (and any OpenAI-compatible API), Anthropic, Ollama, and Google Gemini. You can add as many provider configurations as you want — useful if you're juggling multiple API keys, different endpoints, or a local Ollama model alongside cloud providers. Each provider has its own generation settings: temperature, top-p, top-k, max tokens, repetition/frequency/presence penalties, and reasoning effort. You can test a provider connection from the UI before using it.

Anthropic extended thinking is supported with configurable reasoning effort (off, low, medium, high). OpenAI reasoning models (o1 family, etc.) are handled correctly.

### Character Cards

Characters are the core of how Skald works. You can import cards in PNG format (embedded JSON metadata — the standard SillyTavern V2/V3 format) or as raw JSON, and export in either format. Creating from scratch is also supported, as is browsing and importing directly from [Chub.ai](https://chub.ai).

Each character has the usual fields: name, description, personality, scenario, first message, example messages, system prompt, and post-history instructions. Characters support multiple alternate greetings, custom avatar images, background images, color themes, creator metadata, and tags.

There's a built-in AI greeting reformatter that uses a configured provider to clean up imported greetings into a consistent style, and an AI character creator that can generate a full character card from a short description.

### Conversations

Conversations support branching — any message can become the root of a new branch. Each assistant message can have multiple regenerations ("swipes") that you can flip between without losing any of them.

You can edit any message (user or assistant), delete messages, regenerate the last response, or trigger an impersonation (the LLM writes a user message for you). Messages are searchable within a chat.

Chat modes: **Story** (standard roleplay, similar to other services) and **Texting** (the LLM responds as if in a text message conversation).

Each chat can override the global provider, model, generation parameters, persona, render mode, and compaction settings independently.

Chats can be pinned and reordered by drag-and-drop (including long-press drag on mobile), renamed, and exported as JSON or Markdown.

### Context Compaction

When a conversation gets long, Skald can automatically summarize earlier messages to keep the context within the model's window. Compaction can be triggered at a token threshold, after a fixed number of messages, or manually. The summary is stored per-chat and injected at the top of the context window on each generation. Provider, model, and prompt used for compaction are all configurable — globally and per-chat.

### Lorebooks / World Info

Lorebooks inject additional context into prompts based on keyword triggers. When a keyword appears in recent messages, the associated entry is injected. Entries can also be set to "constant" to always inject regardless of keywords.

Lorebooks can be global (reusable across characters) or attached to a specific character, and can be added to individual chats manually. Individual entries can be enabled/disabled per-chat, have configurable insertion order, and support case-sensitive matching.

### Personas

Multiple personas per user, each with a name, display name, description, and optional avatar. One is marked as default; its details are injected into the prompt and used for `{{user}}` substitution. Personas can be switched per-chat.

### Themes and Appearance

Full theming system with dark and light mode. Custom themes are built by adjusting CSS color variables for backgrounds, text, cards, accents, borders, and speech/thought/narration formatting. Characters can carry their own theme overrides, with a setting to automatically apply a character's theme when chatting with them.

Other appearance settings: font size (small, medium, large), compact mode, reduce motion, color-coded character cards in the sidebar, and per-user customization of how speech, thoughts, narration, and links are rendered (opacity, bold, italic).

### Notifications

Web Push is supported for new messages when the tab is in the background. Notifications can show message content or be generic. Quiet hours can be configured to suppress notifications during a time window. Unread counts are tracked per chat and shown in the sidebar. You can manage and revoke push subscriptions per device from the Signed-in Devices settings page. You need HTTPS and valid VAPID keys for push to work.

### Multi-User and Admin

Multiple users can share one instance with fully separated data. The first user to log in becomes admin. Admins can:

- Create and manage user accounts
- Configure per-user resource quotas (character count, lorebook count, chat count, storage)
- Set rate limits for chat, character import, lorebook import, and Chub API calls
- Toggle character import/export and Chub browsing globally
- Adjust upload size caps

### Mobile

Sidebar swipe-to-open/close, long-press drag-to-reorder pinned chats with haptic feedback, swipe-to-dismiss modals, and swipe between modal tabs. Installable as a PWA. Web Push works on iOS (17.4+) and Android.

## Tech Stack

- SvelteKit 2 + Svelte 5 (runes)
- Tailwind CSS v4
- SQLite via better-sqlite3 + Drizzle ORM
- Server-Sent Events for streaming responses
- AGPL-3.0-only license
