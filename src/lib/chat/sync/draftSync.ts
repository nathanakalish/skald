import type { DraftStore } from '../state/drafts.svelte';

/**
 * Persists the compose-textarea draft and inline-edit buffer to localStorage
 * (offline survival) and the server (cross-device sync). The store is a
 * passive value holder — this class owns the timers, fetch, and localStorage.
 *
 * ChatView wires this up from `$effect`s:
 *   - noteLocalInputChange / noteLocalEditChange whenever the local buffer
 *     diverges (debounces a PATCH).
 *   - pullInput / pullEdit whenever the server-side chat row updates (may
 *     mirror a newer remote value back into the buffer).
 *   - flushAll on blur, visibilitychange, unmount.
 *
 * Constructor takes a getter for chat id (the value can change when the user
 * switches conversations mid-session) and a getter for connection state
 * (skip PATCH while offline — the reconnect path will replay).
 */
export const DRAFT_SAVE_DEBOUNCE_MS = 1500;

export interface DraftSyncOpts {
	store: DraftStore;
	getChatId: () => number;
	isOnline: () => boolean;
	/** Override for tests. */
	now?: () => number;
	debounceMs?: number;
}

export class DraftSync {
	private store: DraftStore;
	private getChatId: () => number;
	private isOnline: () => boolean;
	private now: () => number;
	private debounceMs: number;

	private inputTimer: ReturnType<typeof setTimeout> | null = null;
	private editTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(opts: DraftSyncOpts) {
		this.store = opts.store;
		this.getChatId = opts.getChatId;
		this.isOnline = opts.isOnline;
		this.now = opts.now ?? (() => Date.now());
		this.debounceMs = opts.debounceMs ?? DRAFT_SAVE_DEBOUNCE_MS;
	}

	/* ---------- INPUT (compose textarea) ---------- */

	/**
	 * Persist to localStorage and schedule a debounced PATCH. Called from a
	 * $effect that tracks `store.input`. Safe to call on every keystroke.
	 */
	noteLocalInputChange(): void {
		const chatId = this.getChatId();
		const draft = this.store.input;
		if (typeof localStorage !== 'undefined') {
			if (draft) {
				localStorage.setItem(`skald-draft-${chatId}`, draft);
				localStorage.setItem(`skald-draft-${chatId}-at`, String(this.store.lastLocalInputAt || this.now()));
			} else {
				localStorage.removeItem(`skald-draft-${chatId}`);
				localStorage.removeItem(`skald-draft-${chatId}-at`);
			}
		}
		if (draft === this.store.lastSyncedInput) return; // came FROM the server, don't loop
		if (!this.isOnline()) return; // reconnect path will replay
		if (this.inputTimer) clearTimeout(this.inputTimer);
		this.inputTimer = setTimeout(() => void this.flushInput(), this.debounceMs);
	}

	/**
	 * Mirror server draft into the local buffer when the remote snapshot is
	 * newer than our latest local edit. Called from a $effect that watches
	 * the chat row's pendingDraft fields.
	 */
	pullInput(remote: string | null | undefined, remoteAt: number | null | undefined): void {
		const r = remote ?? '';
		const rAt = remoteAt ?? 0;
		if (rAt === this.store.lastSyncedInputAt && r === this.store.lastSyncedInput) return;
		// Server snapshot is older than our latest keystroke — don't clobber
		// the user; our pending PATCH will overwrite the remote anyway.
		if (rAt < this.store.lastLocalInputAt) return;
		this.store.markInputSynced(r, rAt);
		if (this.store.input !== r) this.store.input = r;
	}

	async flushInput(): Promise<void> {
		if (this.inputTimer) {
			clearTimeout(this.inputTimer);
			this.inputTimer = null;
		}
		const draft = this.store.input;
		if (draft === this.store.lastSyncedInput) return;
		const at = this.store.lastLocalInputAt || this.now();
		const chatId = this.getChatId();
		try {
			await fetch(`/api/chats/${chatId}/draft`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ draft: draft || null, draftAt: at })
			});
			this.store.markInputSynced(draft, at);
		} catch {
			// offline — localStorage retains it, reconnect push will cover.
		}
	}

	/* ---------- INLINE EDIT BUFFER ---------- */

	noteLocalEditChange(): void {
		if (!this.isOnline()) return;
		if (this.editTimer) clearTimeout(this.editTimer);
		this.editTimer = setTimeout(() => void this.flushEdit(), this.debounceMs);
	}

	pullEdit(
		remoteId: number | null | undefined,
		remoteContent: string | null | undefined,
		remoteAt: number | null | undefined
	): void {
		const rId = remoteId ?? null;
		const rContent = remoteContent ?? '';
		const rAt = remoteAt ?? 0;
		if (
			rId === this.store.lastSyncedEditId &&
			rContent === this.store.lastSyncedEditContent &&
			rAt === this.store.lastSyncedEditAt
		) {
			return;
		}
		if (rAt < this.store.lastLocalEditAt) return;
		this.store.markEditSynced(rId, rContent, rAt);
		this.store.editingId = rId;
		this.store.editContent = rId == null ? '' : rContent;
	}

	async flushEdit(): Promise<void> {
		if (this.editTimer) {
			clearTimeout(this.editTimer);
			this.editTimer = null;
		}
		const id = this.store.editingId;
		const content = this.store.editContent;
		if (id === this.store.lastSyncedEditId && content === this.store.lastSyncedEditContent) return;
		const at = this.store.lastLocalEditAt || this.now();
		const chatId = this.getChatId();
		try {
			await fetch(`/api/chats/${chatId}/draft`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					editingMessageId: id,
					editingMessageContent: id == null ? null : content,
					editingAt: at
				})
			});
			this.store.markEditSynced(id, id == null ? '' : content, at);
		} catch {
			// offline — reconnect path replays.
		}
	}

	/* ---------- LIFECYCLE ---------- */

	async flushAll(): Promise<void> {
		await Promise.all([this.flushInput(), this.flushEdit()]);
	}

	dispose(): void {
		if (this.inputTimer) clearTimeout(this.inputTimer);
		if (this.editTimer) clearTimeout(this.editTimer);
		this.inputTimer = null;
		this.editTimer = null;
	}
}
