// Client-side SSE event dispatcher. Routes incoming realtime envelopes to the
// right per-resource store. The +layout.svelte SSE handler calls this for
// every event whose `type` matches a resource event prefix.
//
// All dispatches are idempotent — safe to run on echoes from the originating
// tab because store mutations are upserts/no-ops.
//
// Payload shapes are guarded at runtime via `realtime/guards.ts` so a
// malformed event from a buggy or future endpoint can't silently corrupt the
// stores. Unknown / malformed events log once and get dropped.

import { chatsStore, type ChatRow } from '$lib/stores/chats.svelte.js';
import { charactersStore, type CharacterLight } from '$lib/stores/characters.svelte.js';
import { providersStore, type ProviderLight } from '$lib/stores/providers.svelte.js';
import { lorebooksStore, type LorebookLight } from '$lib/stores/lorebooks.svelte.js';
import { personasStore, type Persona } from '$lib/stores/personas.svelte.js';
import { themesStore, type Theme } from '$lib/stores/themes.svelte.js';
import {
	hasChat, hasCharacter, hasProvider, hasLorebook, hasPersona, hasTheme,
	hasIdPatch, hasJustId, hasProviderArray, hasPersonaArray
} from './guards.js';

interface RawEnvelope {
	type: string;
	chatId?: number;
	userId?: number;
	data?: unknown;
}

function warnMalformed(type: string, payload: unknown) {
	if (typeof console !== 'undefined') {
		console.warn('[realtime] dropping malformed event', type, payload);
	}
}

/**
 * Dispatch a realtime envelope to its matching store. Returns true if the
 * envelope was handled (so the caller can skip the legacy chat-stream path).
 */
export function applyRealtimeEvent(env: RawEnvelope): boolean {
	const t = env.type;
	const payload = env.data;
	switch (t) {
		// Chats
		case 'chat:created':
			if (hasChat(payload)) chatsStore.add(payload.chat as unknown as ChatRow);
			else warnMalformed(t, payload);
			return true;
		case 'chat:updated':
			if (hasChat(payload)) chatsStore.upsert(payload.chat as unknown as ChatRow);
			else warnMalformed(t, payload);
			return true;
		case 'chat:patched':
			if (hasIdPatch(payload)) chatsStore.update(payload.id, payload.patch as Partial<ChatRow>);
			else warnMalformed(t, payload);
			return true;
		case 'chat:deleted':
			if (hasJustId(payload)) chatsStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;

		// Characters
		case 'character:created':
		case 'character:updated':
			if (hasCharacter(payload)) charactersStore.upsert(payload.character as unknown as CharacterLight);
			else warnMalformed(t, payload);
			return true;
		case 'character:deleted':
			if (hasJustId(payload)) charactersStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;

		// Providers
		case 'provider:created':
		case 'provider:updated':
			if (hasProvider(payload)) providersStore.upsert(payload.provider as unknown as ProviderLight);
			else warnMalformed(t, payload);
			return true;
		case 'provider:deleted':
			if (hasJustId(payload)) providersStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;
		case 'provider:replaced':
			if (hasProviderArray(payload)) providersStore.replaceAll(payload.providers as unknown as ProviderLight[]);
			else warnMalformed(t, payload);
			return true;

		// Lorebooks
		case 'lorebook:created':
		case 'lorebook:updated':
			if (hasLorebook(payload)) lorebooksStore.upsert(payload.lorebook as unknown as LorebookLight);
			else warnMalformed(t, payload);
			return true;
		case 'lorebook:deleted':
			if (hasJustId(payload)) lorebooksStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;

		// Personas
		case 'persona:created':
			if (hasPersona(payload)) personasStore.add(payload.persona as unknown as Persona);
			else warnMalformed(t, payload);
			return true;
		case 'persona:updated':
			if (hasIdPatch(payload) && hasPersona(payload)) {
				// `persona:updated` envelopes carry both `id` and `persona`.
				personasStore.update(payload.id, payload.persona as unknown as Partial<Persona>);
			} else if (hasPersona(payload)) {
				personasStore.update(payload.persona.id, payload.persona as unknown as Partial<Persona>);
			} else {
				warnMalformed(t, payload);
			}
			return true;
		case 'persona:deleted':
			if (hasJustId(payload)) personasStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;
		case 'persona:replaced':
			if (hasPersonaArray(payload)) personasStore.replaceAll(payload.personas as unknown as Persona[]);
			else warnMalformed(t, payload);
			return true;

		// Themes
		case 'theme:created':
		case 'theme:updated':
			if (hasTheme(payload)) themesStore.upsert(payload.theme as unknown as Theme);
			else warnMalformed(t, payload);
			return true;
		case 'theme:deleted':
			if (hasJustId(payload)) themesStore.remove(payload.id);
			else warnMalformed(t, payload);
			return true;
		case 'theme:activated':
			// Legacy event from /api/themes/:id/activate. The new theme model
			// stores per-mode slots in settings (systemDarkThemeId/...) instead of
			// a single active theme, so this no longer drives CSS vars. Kept
			// around for forward-compat: just flip the isActive marker in the
			// themes store in case any UI surfaces it.
			if (hasTheme(payload)) {
				const activeId = payload.theme.id;
				for (const th of themesStore.themes) {
					themesStore.update(th.id, { isActive: th.id === activeId });
				}
			} else {
				warnMalformed(t, payload);
			}
			return true;

		// Messages — these get dispatched to the active ChatView via the
		// `streamEvent` forwarding in +layout.svelte (which lets ChatView react
		// to live changes from another tab/device). Returning false here means
		// the layout's switch won't short-circuit, so the message:* envelope
		// keeps flowing through to the streamEvent assignment below it.
		case 'message:created':
		case 'message:patched':
		case 'message:deleted':
			return false;
	}
	return false;
}
