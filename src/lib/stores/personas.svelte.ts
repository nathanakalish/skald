// Persona list store. Personas are tiny — always hydrated in full.

import { createEntityStore } from './createEntityStore.svelte';

export interface Persona {
	id: number;
	userId: number;
	name: string;
	displayName: string | null;
	description: string | null;
	avatarPath: string | null;
	isDefault: boolean;
	[k: string]: unknown;
}

const store = createEntityStore<Persona>({
	apiPath: '/api/personas',
	extractList: (body) => (Array.isArray(body?.personas) ? body.personas : []),
	// Personas have an exclusive "default" flag — adding/promoting one demotes the rest.
	addPosition: 'back',
	onAdd: (without, p) => p.isDefault
		? [p, ...without.map(x => ({ ...x, isDefault: false }))]
		: [...without, p],
	onUpdate: (next, idx, patch) => {
		if (!patch.isDefault) return next;
		const out = next.slice();
		for (let i = 0; i < out.length; i++) {
			if (i !== idx && out[i].isDefault) out[i] = { ...out[i], isDefault: false };
		}
		return out;
	},
});

export const personasStore = {
	get personas() { return store.items; },
	get loaded() { return store.loaded; },
	get loading() { return store.loading; },
	get defaultPersona() { return store.items.find(p => p.isDefault) ?? null; },
	hydrate: store.hydrate,
	load: store.load,
	add: store.add,
	update: store.update,
	remove: store.remove,
	// Replace the whole list (used after the server returns the canonical
	// post-mutation list, e.g. when isDefault toggling needs reconciliation).
	replaceAll: store.replaceAll,
	reset: store.reset,
};
