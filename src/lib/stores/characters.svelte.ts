// Character list store — single source of truth for the character picker.
//
// Holds only lightweight fields (id, name, avatarPath, description, tags,
// creator, theme, backgroundPath, characterVersion, createdAt, updatedAt).
// Heavy fields (firstMessage, alternateGreetings, personality, scenario,
// systemPrompt, mesExample, postHistoryInstructions, creatorNotes,
// extensions) live on the full character row fetched on demand via
// GET /api/characters/:id when the editor opens.

import { createEntityStore } from './createEntityStore.svelte';

export interface CharacterLight {
	id: number;
	name: string;
	avatarPath: string | null;
	description: string | null;
	tags: string | null;
	creator: string | null;
	characterVersion: string | null;
	theme: string | null;
	backgroundPath: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	[k: string]: unknown;
}

const store = createEntityStore<CharacterLight>({
	apiPath: '/api/characters',
	extractList: (body) => body?.characters ?? [],
});

export const charactersStore = {
	get characters() { return store.items; },
	get loaded() { return store.loaded; },
	get loading() { return store.loading; },
	hydrate: store.hydrate,
	load: store.load,
	add: store.add,
	update: store.update,
	upsert: store.upsert,
	remove: store.remove,
	reset: store.reset,
};
