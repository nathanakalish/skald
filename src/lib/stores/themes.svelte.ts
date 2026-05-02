// Theme list store. Holds the list shown in the appearance picker.
//
// Note: activating a theme rewrites root CSS variables; that side-effect
// currently lives in +layout.svelte and reads `data.activeTheme` from SSR.
// Until the layout slimming pass (slice 1d) moves the active theme into a
// settings store, theme activation/deletion still needs an invalidateAll().

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

let _themes = $state<Theme[]>([]);
let _loaded = $state(false);
let _loading = $state(false);

export const themesStore = {
	get themes() { return _themes; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },

	hydrate(initial: Theme[], opts?: { force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_themes = initial.slice();
		_loaded = true;
	},

	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/themes');
			if (!res.ok) return;
			const body = await res.json();
			const activeId = body?.activeThemeId ?? null;
			_themes = (body?.themes ?? []).map((t: Theme) => ({ ...t, isActive: activeId != null && t.id === activeId }));
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	add(theme: Theme) {
		const without = _themes.filter(t => t.id !== theme.id);
		_themes = [...without, theme];
	},

	update(id: number, patch: Partial<Theme>) {
		const idx = _themes.findIndex(t => t.id === id);
		if (idx === -1) return;
		const next = _themes.slice();
		next[idx] = { ..._themes[idx], ...patch };
		_themes = next;
	},

	upsert(theme: Theme) {
		const idx = _themes.findIndex(t => t.id === theme.id);
		if (idx === -1) {
			_themes = [..._themes, theme];
		} else {
			const next = _themes.slice();
			// Preserve the local isActive flag — server PUT doesn't track it.
			next[idx] = { ...theme, isActive: _themes[idx].isActive };
			_themes = next;
		}
	},

	remove(id: number) {
		_themes = _themes.filter(t => t.id !== id);
	},

	reset() {
		_themes = [];
		_loaded = false;
		_loading = false;
	}
};
