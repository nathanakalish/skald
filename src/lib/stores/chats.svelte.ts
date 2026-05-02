// Chat list store — single source of truth for the sidebar.
//
// Server-paginated. The first page (50 chats by default, plus all pinned) hydrates
// either from layout SSR data or from GET /api/chats. After that, every mutation
// updates the store optimistically and reconciles with the server's returned
// canonical row instead of nuking everything with invalidateAll().

export interface ChatRow {
	id: number;
	title: string | null;
	characterId: number;
	characterName: string;
	characterAvatar: string | null;
	mode: string | null;
	pinned: number | boolean | null;
	pinOrder: number | null;
	updatedAt: string | null;
	unread: number | null;
	muted: boolean | null;
	lastMessage: string;
	lastMessageRole: string;
	[k: string]: unknown;
}

let _chats = $state<ChatRow[]>([]);
let _loaded = $state(false);
let _loading = $state(false);
let _hasMore = $state(false);
let _nextCursor = $state<string | null>(null);
let _loadingMore = $state(false);

// Server-side search results — kept separate from `_chats` so a search doesn't
// blow away the paginated cache. The sidebar reads `searchResults` when a query
// is active, otherwise `_chats`.
let _searchQuery = $state('');
let _searchResults = $state<ChatRow[]>([]);
let _searching = $state(false);
let _searchSeq = 0;

export const chatsStore = {
	get chats() { return _chats; },
	get loaded() { return _loaded; },
	get loading() { return _loading; },
	get hasMore() { return _hasMore; },
	get loadingMore() { return _loadingMore; },
	get searchQuery() { return _searchQuery; },
	get searchResults() { return _searchResults; },
	get searching() { return _searching; },

	/**
	 * Hydrate from SSR data so we can skip the network round-trip on first load.
	 * Idempotent — second calls are ignored unless `force` is set.
	 */
	hydrate(initial: ChatRow[], opts?: { hasMore?: boolean; nextCursor?: string | null; force?: boolean }) {
		if (_loaded && !opts?.force) return;
		_chats = initial.slice();
		_hasMore = opts?.hasMore ?? false;
		_nextCursor = opts?.nextCursor ?? null;
		_loaded = true;
	},

	/** Fetch the first page from the server. Use when there's no SSR data to seed from. */
	async load(force = false) {
		if (_loaded && !force) return;
		if (_loading) return;
		_loading = true;
		try {
			const res = await fetch('/api/chats');
			if (!res.ok) return;
			const body = await res.json();
			_chats = body.chats ?? [];
			_nextCursor = body.nextCursor ?? null;
			_hasMore = !!body.nextCursor;
			_loaded = true;
		} finally {
			_loading = false;
		}
	},

	/** Fetch the next page and append. No-op when there's nothing more to load. */
	async loadMore() {
		if (!_hasMore || _loadingMore || !_nextCursor) return;
		_loadingMore = true;
		try {
			const res = await fetch(`/api/chats?cursor=${encodeURIComponent(_nextCursor)}`);
			if (!res.ok) return;
			const body = await res.json();
			const incoming: ChatRow[] = body.chats ?? [];
			// Dedupe by id in case an optimistic entry overlaps with a real row.
			const have = new Set(_chats.map(c => c.id));
			const merged = [..._chats, ...incoming.filter(c => !have.has(c.id))];
			_chats = merged;
			_nextCursor = body.nextCursor ?? null;
			_hasMore = !!body.nextCursor;
		} finally {
			_loadingMore = false;
		}
	},

	/**
	 * Insert a chat at the top of the list (newest first). If a row with the same
	 * id is already there, it gets replaced.
	 */
	add(chat: ChatRow) {
		const without = _chats.filter(c => c.id !== chat.id);
		_chats = [chat, ...without];
	},

	/**
	 * Patch a chat row in place. Silently no-ops if the id isn't in the store —
	 * it might live on a page we haven't loaded yet.
	 */
	update(id: number, patch: Partial<ChatRow>) {
		const idx = _chats.findIndex(c => c.id === id);
		if (idx === -1) return;
		const next = _chats.slice();
		next[idx] = { ..._chats[idx], ...patch };
		_chats = next;
	},

	/** Replace a chat row with the server's canonical version. Adds it if missing. */
	upsert(chat: ChatRow) {
		const idx = _chats.findIndex(c => c.id === chat.id);
		if (idx === -1) {
			_chats = [chat, ..._chats];
		} else {
			const next = _chats.slice();
			next[idx] = chat;
			_chats = next;
		}
	},

	/** Drop a chat from the store. */
	remove(id: number) {
		_chats = _chats.filter(c => c.id !== id);
	},

	/**
	 * Apply optimistic ordering for the pinned section. Caller hands us a desired
	 * pin order map (chatId → pinOrder) and a pin-state map (chatId → pinned),
	 * both of which get merged into the in-memory rows.
	 */
	applyPinOverrides(pinState: Map<number, boolean>, pinOrder: Map<number, number> | null) {
		if (pinState.size === 0 && (!pinOrder || pinOrder.size === 0)) return;
		const next = _chats.map(c => {
			const newPin = pinState.has(c.id) ? pinState.get(c.id)! : undefined;
			const newOrder = pinOrder?.get(c.id);
			if (newPin === undefined && newOrder === undefined) return c;
			return {
				...c,
				...(newPin !== undefined ? { pinned: newPin ? 1 : 0 } : {}),
				...(newOrder !== undefined ? { pinOrder: newOrder } : {})
			};
		});
		_chats = next;
	},

	/** Wipe everything on logout / user switch. */
	reset() {
		_chats = [];
		_loaded = false;
		_loading = false;
		_hasMore = false;
		_nextCursor = null;
		_loadingMore = false;
		_searchQuery = '';
		_searchResults = [];
		_searching = false;
	},

	/**
	 * Run a server-side search. Results land in `searchResults`; the paginated
	 * `chats` cache is left alone. Stale responses get dropped via seq.
	 */
	async search(query: string) {
		const q = query.trim();
		_searchQuery = q;
		if (!q) {
			_searchResults = [];
			_searching = false;
			return;
		}
		const seq = ++_searchSeq;
		_searching = true;
		try {
			const res = await fetch(`/api/chats?q=${encodeURIComponent(q)}`);
			if (!res.ok) return;
			const body = await res.json();
			if (seq !== _searchSeq) return; // stale
			_searchResults = body.chats ?? [];
		} finally {
			if (seq === _searchSeq) _searching = false;
		}
	},

	clearSearch() {
		_searchSeq++;
		_searchQuery = '';
		_searchResults = [];
		_searching = false;
	}
};
