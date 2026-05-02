# Skald

Skald is a self-hosted AI chat and roleplay app. It runs entirely on your own machine (or server), stores everything in a local SQLite database, and connects to whatever LLM providers you configure. There's no cloud account required, no subscription, and your data stays yours.

## Getting Started

```sh
npm install
npm run dev
```

The first time you open it, you'll need to sign in via your configured OIDC / SSO provider. The first user to log in is automatically granted admin. See the OIDC environment variables in `docker-compose.yml` for configuration.

## Building

```sh
npm run build
```

## Features

### LLM Providers

Skald supports OpenAI (and any OpenAI-compatible API), Anthropic, Ollama, and Google Gemini out of the box. You can add as many provider configurations as you want — useful if you're juggling multiple API keys, different endpoints, or local Ollama models alongside cloud providers. Each provider has its own settings for things like temperature, context size, max tokens, repetition penalties, and so on. You can also test a provider connection from the UI before committing to it.

For Anthropic, extended thinking is supported and you can configure the reasoning effort level (off, low, medium, high). OpenAI reasoning models (o1, etc.) are also handled properly.

### Character Cards

Characters are the core of how Skald works. You can import character cards in PNG format (with embedded JSON metadata, the standard SillyTavern V2/V3 format) or as raw JSON files, and export them in either format too. Creating characters from scratch in the UI is also supported.

Each character card has the usual fields — name, description, personality, scenario, first message, example messages, system prompt, and post-history instructions. Characters can have multiple alternate greetings, which you can pick from when starting a new chat. There's also a built-in greeting reformatter that uses an AI provider to clean up greetings into a consistent style.

Characters can have their own avatar images, custom color themes, background images, creator metadata, and tags.

### Conversations

Conversations support branching — if you click the branch button, the current message just becomes a different branch you can go back to. Each message can have multiple regenerations (or "swipes"), and you can flip between them without losing any of them.

You can edit any message (user or assistant), delete messages, regenerate the last AI response, or have the LLM impersonate you. There's also a search that lets you find messages within a chat.

Chat modes: story mode which is roleplay-focused, and is more like other services. Texting mode can take character greetings and the character info to behave like a text messaging conversation.

Each chat can have overrides for the provider, model, generation parameters, persona, and various other display settings separate from the global settings.

Chats can be pinned to the top of the sidebar and reordered by dragging (including on mobile, with a long-press to activate drag). You can also rename chats and export them as JSON or Markdown.

### Lorebooks / World Info

Lorebooks let you inject additional context into prompts based on keyword triggers. When a keyword appears in recent user messages, the associated lorebook entry gets injected into the prompt. Entries can also be set to "constant" to always inject regardless of keywords.

Lorebooks can be global (reusable across characters) or linked to specific characters, and you can also add any lorebook to a specific chat manually. Individual entries can be enabled or disabled, have configurable insertion order, and support case-sensitive matching.

### Personas

You can create multiple user personas, each with a name, display name, and description. One persona is set as the default, and its details get injected into the prompt and used for `{{user}}` variable substitution. You can switch personas per-chat if needed.

### Themes and Appearance

Skald has a full theming system with dark and light mode. You can create custom themes by adjusting color variables for backgrounds, text, cards, accents, borders, and dialogue/speech colors. Characters can define their own theme overrides, and there's a setting to automatically apply a character's theme when chatting with them.

Other appearance settings: font size (small, medium, large), compact mode, reduce motion, and whether to color-code character cards in the sidebar.

### Notifications

Browser notifications are supported for new messages. You can configure whether notifications show only when the tab is unfocused (the default) or always, whether they include the message content or are generic, and whether a sound plays. Unread message counts are tracked per chat and shown in the sidebar.

### Multi-User

Multiple people can use the same Skald instance with separate accounts. The first account created is the admin, who can manage users through the admin settings panel. All data (characters, chats, lorebooks, personas, themes, settings) is scoped to each user.

### Mobile

The sidebar can be opened and closed with a swipe gesture, and pinned chats support touch drag-to-reorder with haptic feedback. Modals support swipe-to-dismiss and tab-swiping. The app is installable as a PWA.

## Tech Stack

- SvelteKit + Svelte 5 (runes)
- Tailwind CSS v4
- SQLite via better-sqlite3 + Drizzle ORM
- Server-Sent Events for streaming responses
