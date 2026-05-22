// Theme list store. Holds the list shown in the appearance picker.
//
// Note: activating a theme rewrites root CSS variables; that side-effect
// currently lives in +layout.svelte and reads `data.activeTheme` from SSR.
// Until the layout slimming pass (slice 1d) moves the active theme into a
// settings store, theme activation/deletion still needs an invalidateAll().

import { createEntityStore } from './createEntityStore.svelte';

export interface Theme {
	id: number;
	userId: number | null;
	name: string;
	mode: 'light' | 'dark' | string;
	colors: string;
	isActive?: boolean;
	isBuiltin: boolean;
	[k: string]: unknown;
}

const store = createEntityStore<Theme>({
	apiPath: '/api/themes',
	extractList: (body) => body?.themes ?? [],
	loadTransform: (items, body) => {
		const activeId = body?.activeThemeId ?? null;
		return items.map(t => ({ ...t, isActive: activeId != null && t.id === activeId }));
	},
	addPosition: 'back',
	// Server PUT response doesn't carry isActive — keep the local flag when upserting.
	mergeOnUpsert: (existing, incoming) => ({ ...incoming, isActive: existing.isActive }),
});

export const themesStore = {
	get themes() { return store.items; },
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
