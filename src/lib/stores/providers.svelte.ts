// Provider list store. Holds the same shape layout.server.ts ships:
// the full provider row minus apiKey, plus a hasKey: boolean flag.

import { createEntityStore } from './createEntityStore.svelte';

export interface ProviderLight {
	id: number;
	userId: number;
	name: string;
	type: string;
	endpoint: string;
	hasKey: boolean;
	defaultModel: string;
	enabled: boolean;
	sortOrder: number;
	[k: string]: unknown;
}

const store = createEntityStore<ProviderLight>({
	apiPath: '/api/providers',
	extractList: (body) => body?.providers ?? [],
	addPosition: 'back',
	// If the removed provider was the enabled default, the server promotes
	// the next one — reflect that locally so the UI doesn't show two states.
	onRemove: (next, removed) => {
		if (!removed?.enabled || next.length === 0) return next;
		if (next.some(p => p.enabled)) return next;
		const out = next.slice();
		out[0] = { ...out[0], enabled: true };
		return out;
	},
});

export const providersStore = {
	get providers() { return store.items; },
	get loaded() { return store.loaded; },
	get loading() { return store.loading; },
	hydrate: store.hydrate,
	load: store.load,
	add: store.add,
	update: store.update,
	upsert: store.upsert,
	remove: store.remove,
	// Replace the whole list (used after reorder / set-default operations
	// that touch many rows at once).
	replaceAll: store.replaceAll,
	reset: store.reset,
};
