// Lorebook list store. Holds the lorebook row (no entries — those are
// fetched on demand by the editor via GET /api/lorebooks/:id).

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

let _lorebooks = $state<LorebookLight[]>([]);
let _loaded = $state(false);
let _loading = $state(false);

export const lorebooksStore = {
	get lorebooks() { return _lorebooks; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },

	hydrate(initial: LorebookLight[], opts?: { force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_lorebooks = initial.slice();
		_loaded = true;
	},

	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/lorebooks');
			if (!res.ok) return;
			const body = await res.json();
			_lorebooks = body.lorebooks ?? [];
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	add(lb: LorebookLight) {
		const without = _lorebooks.filter(l => l.id !== lb.id);
		_lorebooks = [lb, ...without];
	},

	update(id: number, patch: Partial<LorebookLight>) {
		const idx = _lorebooks.findIndex(l => l.id === id);
		if (idx === -1) return;
		const next = _lorebooks.slice();
		next[idx] = { ..._lorebooks[idx], ...patch };
		_lorebooks = next;
	},

	upsert(lb: LorebookLight) {
		const idx = _lorebooks.findIndex(l => l.id === lb.id);
		if (idx === -1) {
			_lorebooks = [lb, ..._lorebooks];
		} else {
			const next = _lorebooks.slice();
			next[idx] = lb;
			_lorebooks = next;
		}
	},

	remove(id: number) {
		_lorebooks = _lorebooks.filter(l => l.id !== id);
	},

	reset() {
		_lorebooks = [];
		_loaded = false;
		_loading = false;
	}
};
