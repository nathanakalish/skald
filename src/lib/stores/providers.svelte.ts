// Provider list store. Holds the same shape layout.server.ts ships:
// the full provider row minus apiKey, plus a hasKey: boolean flag.

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

let _providers = $state<ProviderLight[]>([]);
let _loaded = $state(false);
let _loading = $state(false);

export const providersStore = {
	get providers() { return _providers; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },

	hydrate(initial: ProviderLight[], opts?: { force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_providers = initial.slice();
		_loaded = true;
	},

	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/providers');
			if (!res.ok) return;
			const body = await res.json();
			_providers = body.providers ?? [];
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	add(provider: ProviderLight) {
		const without = _providers.filter(p => p.id !== provider.id);
		_providers = [...without, provider];
	},

	update(id: number, patch: Partial<ProviderLight>) {
		const idx = _providers.findIndex(p => p.id === id);
		if (idx === -1) return;
		const next = _providers.slice();
		next[idx] = { ..._providers[idx], ...patch };
		_providers = next;
	},

	upsert(provider: ProviderLight) {
		const idx = _providers.findIndex(p => p.id === provider.id);
		if (idx === -1) {
			_providers = [..._providers, provider];
		} else {
			const next = _providers.slice();
			next[idx] = provider;
			_providers = next;
		}
	},

	remove(id: number) {
		const removed = _providers.find(p => p.id === id);
		_providers = _providers.filter(p => p.id !== id);
		// If the deleted provider was the default, the server promotes the
		// next one — reflect that locally so the UI doesn't show two states.
		if (removed?.enabled && _providers.length > 0 && !_providers.some(p => p.enabled)) {
			const next = _providers.slice();
			next[0] = { ...next[0], enabled: true };
			_providers = next;
		}
	},

	// Replace the whole list (used after reorder / set-default operations
	// that touch many rows at once).
	replaceAll(list: ProviderLight[]) {
		_providers = list.slice();
		_loaded = true;
	},

	reset() {
		_providers = [];
		_loaded = false;
		_loading = false;
	}
};
