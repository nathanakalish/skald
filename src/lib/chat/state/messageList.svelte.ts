import { diffMessageList, countTrailingPlaceholders } from '$lib/chat/utils/messageListDiff';
import { createPlaceholderIdSeq, type PlaceholderIdSeq } from '$lib/chat/utils/placeholderIds';
import type { Message, MessageImageRow, MessageSiblings } from '$lib/chat/message';

/**
 * Reactive store for the chat's visible messages plus the bookkeeping needed
 * to keep keyed-each animations stable across placeholder→real-id swaps and
 * "load earlier" merges. Everything lives behind methods so the various
 * mutation paths (optimistic sends, server diffs, SSE events, edits) all go
 * through one place — no scattered `messageList[i] = ...` writes from
 * components.
 */
export class MessageListStore {
	list = $state<Message[]>([]);
	siblings = $state<MessageSiblings>({});
	images = $state<Record<number, MessageImageRow[]>>({});
	/** messageId → swipeIndex while an image generation is in flight. */
	imageGenInFlight = $state<Map<number, number>>(new Map());
	totalCount = $state(0);
	/** First index of `list` to actually render. Older entries stay in memory but skip the DOM. */
	renderedStart = $state(0);
	loadingMore = $state(false);

	/**
	 * Ids the UI has already shown an entrance animation for (or that should
	 * skip the animation, e.g. real ids that just replaced placeholders).
	 * Kept as a plain Set on purpose — it's never read reactively, only used
	 * by the animation gate in MessageRow.
	 */
	knownIds: Set<number> = new Set();

	private ids: PlaceholderIdSeq;

	constructor(initial: Message[], siblings: MessageSiblings, totalCount: number, images: Record<number, MessageImageRow[]> = {}) {
		this.list = initial;
		this.siblings = siblings;
		this.totalCount = totalCount || initial.length;
		this.images = images;
		this.knownIds = new Set(initial.map((m) => m.id));
		this.ids = createPlaceholderIdSeq();
	}

	nextPlaceholderId(): number {
		return this.ids.next();
	}

	/** Returns true the first time an id is seen — gates the entrance animation. */
	markAndCheckNew(id: number): boolean {
		if (this.knownIds.has(id)) return false;
		this.knownIds.add(id);
		return true;
	}

	/**
	 * Apply a fresh server snapshot. Handles placeholder→real-id pre-registration
	 * and "load earlier" preservation. No-op when the snapshot matches the
	 * current list. Returns `true` when something actually changed.
	 */
	applyServerSnapshot(incoming: Message[], newSiblings: MessageSiblings, newTotal: number): boolean {
		if (newTotal && newTotal !== this.totalCount) this.totalCount = newTotal;
		const r = diffMessageList(this.list, incoming);
		// Pre-register replacement ids BEFORE the list change — otherwise the
		// keyed each block sees the new id and re-runs msg-enter-story (visible
		// 14px jump right after generation finishes).
		for (const id of r.idsToPreRegister) this.knownIds.add(id);
		if (!r.changed) return false;
		this.list = r.list;
		for (const m of incoming) this.knownIds.add(m.id);
		if (r.safeMerged) Object.assign(this.siblings, newSiblings);
		else this.siblings = newSiblings;
		return true;
	}

	/** Prepend earlier pages without disturbing scroll-related state. */
	prependEarlier(earlier: Message[], newSiblings: MessageSiblings, newTotal?: number): void {
		if (earlier.length === 0) return;
		this.list = [...earlier, ...this.list];
		Object.assign(this.siblings, newSiblings);
		for (const m of earlier) this.knownIds.add(m.id);
		if (newTotal != null) this.totalCount = newTotal;
	}

	appendOptimistic(msg: Message): number {
		this.list = [...this.list, msg];
		// Optimistic placeholders are "new" to the animation system on purpose
		// so they animate in the first time the user sees them.
		return this.list.length - 1;
	}

	updateAt(index: number, patch: Partial<Message>): void {
		const current = this.list[index];
		if (!current) return;
		this.list[index] = { ...current, ...patch };
	}

	updateById(id: number, patch: Partial<Message>): boolean {
		const i = this.list.findIndex((m) => m.id === id);
		if (i < 0) return false;
		this.updateAt(i, patch);
		return true;
	}

	removeAt(index: number): Message | null {
		const removed = this.list[index];
		if (!removed) return null;
		this.list = this.list.toSpliced(index, 1);
		return removed;
	}

	removeById(id: number): boolean {
		const i = this.list.findIndex((m) => m.id === id);
		if (i < 0) return false;
		this.removeAt(i);
		return true;
	}

	get hasMore(): boolean {
		return this.list.length < this.totalCount;
	}

	get trailingPlaceholderCount(): number {
		return countTrailingPlaceholders(this.list);
	}

	/** Drop messageImages entries that no longer have a parent message. */
	pruneOrphanImages(): void {
		const liveIds = new Set(this.list.map((m) => m.id));
		let changed = false;
		const next: Record<number, MessageImageRow[]> = {};
		for (const [k, v] of Object.entries(this.images)) {
			const id = Number(k);
			if (liveIds.has(id)) next[id] = v;
			else changed = true;
		}
		if (changed) this.images = next;
	}

	setImageGenFlight(messageId: number, swipeIndex: number): void {
		const next = new Map(this.imageGenInFlight);
		next.set(messageId, swipeIndex);
		this.imageGenInFlight = next;
	}

	clearImageGenFlight(messageId: number): void {
		if (!this.imageGenInFlight.has(messageId)) return;
		const next = new Map(this.imageGenInFlight);
		next.delete(messageId);
		this.imageGenInFlight = next;
	}

	/* ---------- IMAGE SSE EVENT HELPERS ---------- */

	/**
	 * Append a freshly-generated image and clear the in-flight marker.
	 * Only deactivates siblings WITHIN the same swipe — other swipes keep
	 * their own active selection.
	 */
	addImage(img: MessageImageRow): void {
		const swipeIdx = img.swipeIndex ?? 0;
		const current = this.images[img.messageId] ?? [];
		const list = current.map((it) =>
			(it.swipeIndex ?? 0) === swipeIdx ? { ...it, isActive: false } : it
		);
		list.push(img);
		this.images = { ...this.images, [img.messageId]: list };
		this.clearImageGenFlight(img.messageId);
	}

	/** Switch the active image within a single swipe. Other swipes untouched. */
	activateImage(messageId: number, imageId: number): void {
		const list = this.images[messageId];
		if (!list) return;
		const target = list.find((it) => it.id === imageId);
		const swipeIdx = target?.swipeIndex ?? 0;
		this.images = {
			...this.images,
			[messageId]: list.map((it) => {
				if ((it.swipeIndex ?? 0) !== swipeIdx) return it;
				return { ...it, isActive: it.id === imageId };
			})
		};
	}

	/**
	 * Remove an image. If it was the active one for its swipe and others
	 * remain in that swipe, promote the most recent — mirrors server policy.
	 */
	removeImage(messageId: number, imageId: number): void {
		const list = this.images[messageId];
		if (!list) return;
		const removed = list.find((it) => it.id === imageId);
		const swipeIdx = removed?.swipeIndex ?? 0;
		const next = list.filter((it) => it.id !== imageId);
		const swipeRemaining = next.filter((it) => (it.swipeIndex ?? 0) === swipeIdx);
		if (removed?.isActive && swipeRemaining.length && !swipeRemaining.some((it) => it.isActive)) {
			const lastInSwipe = swipeRemaining[swipeRemaining.length - 1];
			const idx = next.findIndex((it) => it.id === lastInSwipe.id);
			if (idx !== -1) next[idx] = { ...next[idx], isActive: true };
		}
		this.images = { ...this.images, [messageId]: next };
	}
}
