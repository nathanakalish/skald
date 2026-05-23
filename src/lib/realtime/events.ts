// Realtime resource events — pushed over SSE from the server to every tab
// the user has open, so a mutation in one tab/device shows up in the others
// within a single round-trip and without an `invalidateAll()`.
//
// Wire format on `/api/events`:
//   { id: <seq>, type: <string>, userId: <n>, chatId?: <n>, data: <payload> }
//
// The originating tab also receives its own echoes; store mutations are
// idempotent (upsert merges, remove is a no-op if the row is gone) so the
// echo is harmless and we don't need request-id de-dup.

import type { ChatRow } from '$lib/stores/chats.svelte.js';
import type { CharacterLight } from '$lib/stores/characters.svelte.js';
import type { ProviderLight } from '$lib/stores/providers.svelte.js';
import type { LorebookLight } from '$lib/stores/lorebooks.svelte.js';
import type { Persona } from '$lib/stores/personas.svelte.js';
import type { Theme } from '$lib/stores/themes.svelte.js';

// Generic envelope. Payload shape varies by `type` — see `RealtimeEvent`.
interface RealtimeEnvelope<T = unknown> {
	type: string;
	userId: number;
	chatId?: number;
	data: T;
}

// Strongly-typed union of every resource event the server may broadcast.
// Streaming events (token, reasoning, complete, error, tokenStats, unread,
// streaming, chat-muted) live in eventBus and aren't part of this union —
// the client SSE handler dispatches them separately.
export type RealtimeEvent =
	| { type: 'chat:created'; chat: ChatRow }
	| { type: 'chat:updated'; id: number; chat: ChatRow }
	| { type: 'chat:patched'; id: number; patch: Partial<ChatRow> }
	| { type: 'chat:deleted'; id: number }
	| { type: 'character:created'; character: CharacterLight }
	| { type: 'character:updated'; id: number; character: CharacterLight }
	| { type: 'character:deleted'; id: number }
	| { type: 'provider:created'; provider: ProviderLight }
	| { type: 'provider:updated'; id: number; provider: ProviderLight }
	| { type: 'provider:deleted'; id: number }
	| { type: 'provider:replaced'; providers: ProviderLight[] }
	| { type: 'lorebook:created'; lorebook: LorebookLight }
	| { type: 'lorebook:updated'; id: number; lorebook: LorebookLight }
	| { type: 'lorebook:deleted'; id: number }
	| { type: 'persona:created'; persona: Persona }
	| { type: 'persona:updated'; id: number; persona: Persona }
	| { type: 'persona:deleted'; id: number }
	| { type: 'persona:replaced'; personas: Persona[] }
	| { type: 'theme:created'; theme: Theme }
	| { type: 'theme:updated'; id: number; theme: Theme }
	| { type: 'theme:deleted'; id: number }
	| { type: 'theme:activated'; theme: Theme }
	| { type: 'message:created'; chatId: number; message: Record<string, unknown> }
	| { type: 'message:patched'; chatId: number; id: number; patch: Record<string, unknown> }
	| { type: 'message:deleted'; chatId: number; ids: number[] }
	| { type: 'messageImage:created'; chatId: number; messageId: number; image: MessageImage }
	| { type: 'messageImage:activated'; chatId: number; messageId: number; imageId: number }
	| { type: 'messageImage:deleted'; chatId: number; messageId: number; imageId: number }
	| {
			type: 'chat:impersonation';
			chatId: number;
			status: 'streaming' | 'done' | 'error' | null;
			swipes: Array<{
				draft: string;
				reasoning: string;
				guidance?: string;
				generatedAt: string | null;
			}>;
			swipeIndex: number;
	  }
	| { type: 'export:ready' }
	| { type: 'export:failed' };

// Shape of an image attached to a message. Matches the messageImages row,
// minus user-internal columns the client doesn't need.
export interface MessageImage {
	id: number;
	messageId: number;
	swipeIndex: number;
	filePath: string;
	prompt: string;
	model: string;
	providerId: number | null;
	isActive: boolean;
	createdAt: string | null;
}
