/**
 * Pure reconciliation between the locally-held message list and a fresh
 * snapshot from the server. Extracted from ChatView's mega-effect so the
 * subtle bits (placeholder→real-id handoff, "load earlier" preservation,
 * object-reuse for stable keys) are easy to test in isolation.
 *
 * Why it's structural and not Message-typed: the diff genuinely only cares
 * about the few fields below, and keeping it untyped makes it reusable for
 * any future message shape (impersonation swipes, system rows, etc.) without
 * fighting the type system.
 */
export interface DiffableMessage {
	id: number;
	content: string;
	swipeIndex: number;
	swipes: unknown[];
	reasoning: unknown[];
	guidance?: string | null;
	impersonationGuidance?: string | null;
	parentId?: number | null;
}

export interface DiffResult<M extends DiffableMessage> {
	/** New list to assign (only present when `changed` is true). */
	list: M[];
	/**
	 * Real ids that should be marked as "already known" BEFORE the new list is
	 * assigned, so the keyed each-block doesn't re-run entrance animations on
	 * placeholder→real id swaps. Always populated even when `changed` is false
	 * because the keyed each will still see the new ids.
	 */
	idsToPreRegister: number[];
	/** True when the server snapshot only covered the tail and we kept an earlier page. */
	safeMerged: boolean;
	/** False when the incoming snapshot is byte-for-byte equivalent to the current list. */
	changed: boolean;
}

function fieldsEqual<M extends DiffableMessage>(a: M, b: M): boolean {
	return (
		a.content === b.content &&
		a.swipeIndex === b.swipeIndex &&
		(a.guidance ?? null) === (b.guidance ?? null) &&
		(a.impersonationGuidance ?? null) === (b.impersonationGuidance ?? null)
	);
}

function fullyEqual<M extends DiffableMessage>(a: M, b: M): boolean {
	return (
		fieldsEqual(a, b) &&
		a.swipes.length === b.swipes.length &&
		a.reasoning.length === b.reasoning.length
	);
}

/**
 * Count how many trailing entries in `list` are still placeholders. The diff
 * uses this to figure out which incoming ids correspond to those placeholders
 * so they can be marked "known" before the each-block sees them.
 */
export function countTrailingPlaceholders<M extends DiffableMessage>(list: M[]): number {
	let n = 0;
	for (let i = list.length - 1; i >= 0; i--) {
		if (list[i].id < 0) n++;
		else break;
	}
	return n;
}

export function diffMessageList<M extends DiffableMessage>(currentList: M[], incoming: M[]): DiffResult<M> {
	const oldById = new Map<number, M>(currentList.map((m) => [m.id, m]));
	const incomingIds = new Set(incoming.map((m) => m.id));

	// Pre-registration for placeholder→real id handoff.
	const idsToPreRegister: number[] = [];
	const tailPh = countTrailingPlaceholders(currentList);
	if (tailPh > 0) {
		const tail = incoming.slice(-tailPh);
		for (const m of tail) {
			if (m.id > 0 && !oldById.has(m.id)) idsToPreRegister.push(m.id);
		}
	}

	// "Load earlier" preservation: if the user has paged back, the server's
	// tail-window refresh shouldn't wipe the earlier pages. We can keep them
	// only when the chains connect — i.e. the oldest incoming row's parent is
	// still in our list, proving the active branch hasn't changed underneath us.
	const keptEarlier = currentList.filter((m) => !incomingIds.has(m.id));
	const firstIncoming = incoming[0];
	const safeMerged =
		keptEarlier.length > 0 &&
		firstIncoming != null &&
		firstIncoming.parentId != null &&
		oldById.has(firstIncoming.parentId);

	const changed = safeMerged
		? incoming.some((m) => {
				const old = oldById.get(m.id);
				return !old || !fieldsEqual(old, m);
			})
		: incoming.length !== currentList.length ||
			incoming.some((m, idx) => {
				const old = currentList[idx];
				return !old || old.id !== m.id || !fieldsEqual(old, m);
			});

	if (!changed) {
		return { list: currentList, idsToPreRegister, safeMerged, changed: false };
	}

	// Reuse old objects when content is identical so Svelte's keyed each can
	// skip remounting the bubble. Bubble identity preserves edit-buffer state,
	// scroll-into-view animations, and avoids needless DOM work.
	const merged = incoming.map((m) => {
		const old = oldById.get(m.id);
		return old && fullyEqual(old, m) ? old : m;
	});

	const list = safeMerged ? [...keptEarlier, ...merged] : merged;
	return { list, idsToPreRegister, safeMerged, changed: true };
}
