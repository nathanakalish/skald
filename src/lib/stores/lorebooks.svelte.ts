// Lorebook list store. Holds the lorebook row (no entries — those are
// fetched on demand by the editor via GET /api/lorebooks/:id).

import { createEntityStore } from './createEntityStore.svelte';

export interface LorebookLight {
	id: number;
	userId: number;
	name: string;
	description: string | null;
	enabled?: boolean | null;
	characterId?: number | null;
	createdAt: string | null;
	[k: string]: unknown;
}

const store = createEntityStore<LorebookLight>({
	apiPath: '/api/lorebooks',
	extractList: (body) => body?.lorebooks ?? [],
});

export const lorebooksStore = {
	get lorebooks() { return store.items; },
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
