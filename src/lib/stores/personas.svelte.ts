// Persona list store. Personas are tiny — always hydrated in full.

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

let _personas = $state<Persona[]>([]);
let _loaded = $state(false);
let _loading = $state(false);

export const personasStore = {
	get personas() { return _personas; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },
	get defaultPersona() { return _personas.find(p => p.isDefault) ?? null; },

	hydrate(initial: Persona[], opts?: { force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_personas = initial.slice();
		_loaded = true;
	},

	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/personas');
			if (!res.ok) return;
			const body = await res.json();
			_personas = Array.isArray(body?.personas) ? body.personas : [];
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	add(p: Persona) {
		const without = _personas.filter(x => x.id !== p.id);
		_personas = p.isDefault
			? [p, ...without.map(x => ({ ...x, isDefault: false }))]
			: [...without, p];
	},

	update(id: number, patch: Partial<Persona>) {
		const idx = _personas.findIndex(p => p.id === id);
		if (idx === -1) return;
		const next = _personas.slice();
		next[idx] = { ..._personas[idx], ...patch };
		// If this one became the default, demote the others
		if (patch.isDefault) {
			for (let i = 0; i < next.length; i++) {
				if (i !== idx && next[i].isDefault) next[i] = { ...next[i], isDefault: false };
			}
		}
		_personas = next;
	},

	remove(id: number) {
		_personas = _personas.filter(p => p.id !== id);
	},

	// Replace the whole list (used after the server returns the canonical
	// post-mutation list, e.g. when isDefault toggling needs reconciliation).
	replaceAll(list: Persona[]) {
		_personas = list.slice();
		_loaded = true;
	},

	reset() {
		_personas = [];
		_loaded = false;
		_loading = false;
	}
};
