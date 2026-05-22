// Generic entity-list store factory used by characters/personas/lorebooks/themes/providers.
//
// All five followed the same shape (load/hydrate/add/update/upsert/remove + a "loading" guard) with
// minor per-store quirks (add position, isDefault cascades, isActive preservation, default promotion
// on remove). Those quirks are surfaced as optional hooks so each store file can stay a thin wrapper.

import { api } from '$lib/api.js';

export interface EntityStoreOptions<T extends { id: number }> {
	apiPath: string;
	// Map a fetch() response body to the entity list. Default: body.<key> ?? []
	extractList: (body: any) => T[];
	// Post-process the list right after a successful load (e.g. mix in activeThemeId).
	loadTransform?: (items: T[], body: any) => T[];
	// Where does add() insert? Default: 'front'.
	addPosition?: 'front' | 'back';
	// Custom add (overrides addPosition entirely; receives the full new list minus any duplicate).
	onAdd?: (without: T[], incoming: T) => T[];
	// Custom update (receives full list, idx of matching row, patch).
	onUpdate?: (next: T[], idx: number, patch: Partial<T>) => T[];
	// Custom upsert merge for the "row exists" branch (e.g. preserve local isActive).
	mergeOnUpsert?: (existing: T, incoming: T) => T;
	// Custom post-remove transform (e.g. promote a new default).
	onRemove?: (next: T[], removed: T | undefined) => T[];
}

export interface EntityStore<T extends { id: number }> {
	readonly items: T[];
	readonly loaded: boolean;
	readonly loading: boolean;
	hydrate(initial: T[], opts?: { force?: boolean }): void;
	load(force?: boolean): Promise<void>;
	add(item: T): void;
	update(id: number, patch: Partial<T>): void;
	upsert(item: T): void;
	remove(id: number): void;
	replaceAll(list: T[]): void;
	reset(): void;
}

export function createEntityStore<T extends { id: number }>(opts: EntityStoreOptions<T>): EntityStore<T> {
	let _items = $state<T[]>([]);
	let _loaded = $state(false);
	let _loading = $state(false);

	const addPosition = opts.addPosition ?? 'front';

	return {
		get items() { return _items; },
		get loaded() { return _loaded; },
		get loading() { return _loading; },

		hydrate(initial, o) {
			if (_loaded && !o?.force) return;
			_items = initial.slice();
			_loaded = true;
		},

		async load(force = false) {
			if (_loaded && !force) return;
			if (_loading) return;
			_loading = true;
			try {
				// silent: stores are background loaders; let pages render their own empty states
				// instead of toasting every transient failure.
				const body = await api<any>(opts.apiPath, { silent: true });
				if (!body) return;
				const list = opts.extractList(body) ?? [];
				_items = opts.loadTransform ? opts.loadTransform(list, body) : list;
				_loaded = true;
			} finally {
				_loading = false;
			}
		},

		add(item) {
			const without = _items.filter(x => x.id !== item.id);
			if (opts.onAdd) {
				_items = opts.onAdd(without, item);
				return;
			}
			_items = addPosition === 'front' ? [item, ...without] : [...without, item];
		},

		update(id, patch) {
			const idx = _items.findIndex(x => x.id === id);
			if (idx === -1) return;
			const next = _items.slice();
			next[idx] = { ..._items[idx], ...patch };
			_items = opts.onUpdate ? opts.onUpdate(next, idx, patch) : next;
		},

		upsert(item) {
			const idx = _items.findIndex(x => x.id === item.id);
			if (idx === -1) {
				_items = addPosition === 'front' ? [item, ..._items] : [..._items, item];
				return;
			}
			const next = _items.slice();
			next[idx] = opts.mergeOnUpsert ? opts.mergeOnUpsert(_items[idx], item) : item;
			_items = next;
		},

		remove(id) {
			const removed = _items.find(x => x.id === id);
			const next = _items.filter(x => x.id !== id);
			_items = opts.onRemove ? opts.onRemove(next, removed) : next;
		},

		replaceAll(list) {
			_items = list.slice();
			_loaded = true;
		},

		reset() {
			_items = [];
			_loaded = false;
			_loading = false;
		},
	};
}
