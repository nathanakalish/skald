// Character list store — single source of truth for the character picker.
//
// Holds only lightweight fields (id, name, avatarPath, description, tags,
// creator, theme, backgroundPath, characterVersion, createdAt, updatedAt).
// Heavy fields (firstMessage, alternateGreetings, personality, scenario,
// systemPrompt, mesExample, postHistoryInstructions, creatorNotes,
// extensions) live on the full character row fetched on demand via
// GET /api/characters/:id when the editor opens.

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

let _characters = $state<CharacterLight[]>([]);
let _loaded = $state(false);
let _loading = $state(false);

export const charactersStore = {
	get characters() { return _characters; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },

	hydrate(initial: CharacterLight[], opts?: { force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_characters = initial.slice();
		_loaded = true;
	},

	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/characters');
			if (!res.ok) return;
			const body = await res.json();
			_characters = body.characters ?? [];
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	add(character: CharacterLight) {
		const without = _characters.filter(c => c.id !== character.id);
		_characters = [character, ...without];
	},

	update(id: number, patch: Partial<CharacterLight>) {
		const idx = _characters.findIndex(c => c.id === id);
		if (idx === -1) return;
		const next = _characters.slice();
		next[idx] = { ..._characters[idx], ...patch };
		_characters = next;
	},

	upsert(character: CharacterLight) {
		const idx = _characters.findIndex(c => c.id === character.id);
		if (idx === -1) {
			_characters = [character, ..._characters];
		} else {
			const next = _characters.slice();
			next[idx] = character;
			_characters = next;
		}
	},

	remove(id: number) {
		_characters = _characters.filter(c => c.id !== id);
	},

	reset() {
		_characters = [];
		_loaded = false;
		_loading = false;
	}
};
