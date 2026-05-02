import { chatsStore } from '$lib/stores/chats.svelte.js';
import { haptic } from '$lib/utils/haptics.js';

type DropPosition = 'above' | 'below';

interface ChatLike {
	id: number;
	[k: string]: unknown;
}

interface CreateChatReorderOptions {
	/** Live read of the current pinned-chats list (in display order). */
	getPinnedChats: () => ChatLike[];
}

/**
 * Owns drag-reorder + touch-long-press-reorder for the pinned chats row.
 * Lifted out of `+layout.svelte` (originally lines 1438–2007 — ~280 lines of
 * state and handlers, which was getting embarrassing).
 *
 * Exposes:
 *   - reactive getters for `dragOverChatId`, `dropPosition`, `dragChatId`,
 *     `touchDragChatId` and `pinOrderOverrides` (sidebar uses these to render
 *     drop indicators and apply optimistic ordering).
 *   - desktop drag handlers (`handleDragStart`/`handleDragOver`/`handleDrop`/
 *     `handleDragEnd` plus container/nav variants).
 *   - touch handlers (`handleTouchStart`/`Move`/`End`/`Cancel`) for the
 *     long-press-then-drag flow on mobile.
 *
 * Reorders are optimistic: the override map applies immediately and clears
 * once every PATCH lands. On any failure or 3-second timeout we drop the
 * override and pull the canonical state back down.
 */
export function createChatReorder({ getPinnedChats }: CreateChatReorderOptions) {
	// Mouse / DnD state
	let dragChatId = $state<number | null>(null);
	let dragOverChatId = $state<number | null>(null);
	let dropPosition = $state<DropPosition>('below');

	// Touch state
	let touchDragChatId = $state<number | null>(null);
	let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let touchStartY = 0;
	let touchScrollParent: HTMLElement | null = null;
	// RAF coalescing for touchmove hit-testing. Without this we hammer
	// getBoundingClientRect on every move and the phone melts.
	let touchMoveRaf: number | null = null;
	let latestTouchX = 0;
	let latestTouchY = 0;

	// Optimistic pin-order overrides (chatId → display index)
	let pinOrderOverrides = $state<Map<number, number> | null>(null);

	function getDropPosition(clientY: number, targetEl: HTMLElement): DropPosition {
		const rect = targetEl.getBoundingClientRect();
		return clientY < rect.top + rect.height / 2 ? 'above' : 'below';
	}

	async function performReorder(fromChatId: number, toChatId: number, position: DropPosition) {
		if (fromChatId === toChatId) return;

		const pinned = [...getPinnedChats()];
		const dragIdx = pinned.findIndex((c) => c.id === fromChatId);
		let targetIdx = pinned.findIndex((c) => c.id === toChatId);
		if (dragIdx === -1 || targetIdx === -1) return;

		const reordered = [...pinned];
		const [moved] = reordered.splice(dragIdx, 1);
		if (dragIdx < targetIdx) targetIdx--;
		const insertIdx = position === 'below' ? targetIdx + 1 : targetIdx;
		reordered.splice(insertIdx, 0, moved);

		// Optimistic override
		const overrides = new Map<number, number>();
		for (let i = 0; i < reordered.length; i++) overrides.set(reordered[i].id, i);
		pinOrderOverrides = overrides;

		try {
			const results = await Promise.race([
				Promise.all(
					reordered.map((chat, i) =>
						fetch(`/api/chats/${chat.id}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ pinOrder: i })
						})
					)
				),
				new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000))
			]);

			if (results === 'timeout') {
				pinOrderOverrides = null;
				await chatsStore.load(true);
				return;
			}

			const allOk = (results as Response[]).every((r) => r.ok);
			if (!allOk) {
				pinOrderOverrides = null;
				await chatsStore.load(true);
				return;
			}

			for (const r of results as Response[]) {
				try {
					const body = await r.json();
					if (body?.chat) chatsStore.upsert(body.chat);
				} catch {
					/* ignore individual JSON parse errors */
				}
			}
			pinOrderOverrides = null;
		} catch {
			pinOrderOverrides = null;
			await chatsStore.load(true);
		}
	}

	// ---- Desktop drag handlers ----

	function handleDragStart(chatId: number, e: DragEvent) {
		dragChatId = chatId;
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function handleDragOver(chatId: number, e: DragEvent) {
		e.preventDefault();
		dragOverChatId = chatId;
		dropPosition = getDropPosition(e.clientY, e.currentTarget as HTMLElement);
	}

	function handleDrop(targetChatId: number, e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const fromId = dragChatId;
		const pos = dropPosition;
		dragChatId = null;
		dragOverChatId = null;
		if (!fromId || fromId === targetChatId) return;
		performReorder(fromId, targetChatId, pos);
	}

	function handleDragEnd() {
		dragChatId = null;
		dragOverChatId = null;
	}

	function handlePinnedRowDragOver(e: DragEvent) {
		if (!dragChatId) return;
		// Container-wide hit zone for the horizontal pinned row — pick the nearest
		// pinned item by clientX, then snap above/below from its midpoint.
		const row = e.currentTarget as HTMLElement;
		const items = Array.from(row.querySelectorAll<HTMLElement>('[data-pinned-chat-id]'));
		if (items.length === 0) return;
		e.preventDefault();
		let nearest = items[0];
		let nearestDist = Infinity;
		for (const el of items) {
			const r = el.getBoundingClientRect();
			const center = r.left + r.width / 2;
			const dist = Math.abs(e.clientX - center);
			if (dist < nearestDist) {
				nearestDist = dist;
				nearest = el;
			}
		}
		const id = Number(nearest.dataset.pinnedChatId);
		if (Number.isNaN(id) || id === dragChatId) return;
		const r = nearest.getBoundingClientRect();
		dragOverChatId = id;
		dropPosition = e.clientX < r.left + r.width / 2 ? 'above' : 'below';
	}

	function handlePinnedRowDrop(e: DragEvent) {
		if (!dragChatId || !dragOverChatId) return;
		e.preventDefault();
		e.stopPropagation();
		const fromId = dragChatId;
		const toId = dragOverChatId;
		const pos = dropPosition;
		dragChatId = null;
		dragOverChatId = null;
		if (fromId === toId) return;
		performReorder(fromId, toId, pos);
	}

	function handlePinnedContainerDragOver(e: DragEvent) {
		if (!dragChatId) return;
		e.preventDefault();
		const target = (e.target as HTMLElement).closest('[data-pinned-chat-id]');
		if (target) return;
		const allPinned = document.querySelectorAll('[data-pinned-chat-id]');
		if (allPinned.length > 0) {
			const firstEl = allPinned[0] as HTMLElement;
			const lastEl = allPinned[allPinned.length - 1] as HTMLElement;
			const firstRect = firstEl.getBoundingClientRect();
			const lastRect = lastEl.getBoundingClientRect();
			const firstId = Number(firstEl.dataset.pinnedChatId);
			const lastId = Number(lastEl.dataset.pinnedChatId);

			if (e.clientY < firstRect.top + firstRect.height / 2 && firstId !== dragChatId) {
				dragOverChatId = firstId;
				dropPosition = 'above';
			} else if (e.clientY > lastRect.top + lastRect.height / 2 && lastId !== dragChatId) {
				dragOverChatId = lastId;
				dropPosition = 'below';
			}
		}
	}

	function handlePinnedContainerDrop(e: DragEvent) {
		e.preventDefault();
		const fromId = dragChatId;
		const toId = dragOverChatId;
		const pos = dropPosition;
		dragChatId = null;
		dragOverChatId = null;
		if (!fromId || !toId || fromId === toId) return;
		performReorder(fromId, toId, pos);
	}

	function handleNavDragOver(e: DragEvent) {
		if (!dragChatId) return;
		const pinnedContainer = (e.target as HTMLElement).closest('[data-pinned-container]');
		if (pinnedContainer) return;
		e.preventDefault();
		const allPinned = document.querySelectorAll('[data-pinned-chat-id]');
		if (allPinned.length === 0) return;
		const firstEl = allPinned[0] as HTMLElement;
		const lastEl = allPinned[allPinned.length - 1] as HTMLElement;
		const firstRect = firstEl.getBoundingClientRect();
		const lastRect = lastEl.getBoundingClientRect();
		const firstId = Number(firstEl.dataset.pinnedChatId);
		const lastId = Number(lastEl.dataset.pinnedChatId);

		if (e.clientY <= firstRect.top && firstId !== dragChatId) {
			dragOverChatId = firstId;
			dropPosition = 'above';
		} else if (e.clientY >= lastRect.bottom && lastId !== dragChatId) {
			dragOverChatId = lastId;
			dropPosition = 'below';
		}
	}

	function handleNavDrop(e: DragEvent) {
		if (!dragChatId || !dragOverChatId) return;
		e.preventDefault();
		e.stopPropagation();
		const fromId = dragChatId;
		const toId = dragOverChatId;
		const pos = dropPosition;
		dragChatId = null;
		dragOverChatId = null;
		if (fromId === toId) return;
		performReorder(fromId, toId, pos);
	}

	// ---- Touch handlers (long-press-then-drag on mobile) ----

	function handleTouchStart(chatId: number, e: TouchEvent) {
		touchStartY = e.touches[0].clientY;
		touchScrollParent = (e.target as HTMLElement).closest('nav');
		// Long press to start drag (400ms). Scroll stays free during the wait.
		touchLongPressTimer = setTimeout(() => {
			touchLongPressTimer = null;
			touchDragChatId = chatId;
			dragChatId = chatId;
			haptic('heavy');
			// Lock scroll now that we're actually dragging.
			if (touchScrollParent) touchScrollParent.style.overflowY = 'hidden';
		}, 400);
	}

	function handleTouchCancel() {
		if (touchLongPressTimer) {
			clearTimeout(touchLongPressTimer);
			touchLongPressTimer = null;
		}
		if (touchMoveRaf != null) {
			cancelAnimationFrame(touchMoveRaf);
			touchMoveRaf = null;
		}
		if (touchScrollParent) {
			touchScrollParent.style.overflowY = '';
			touchScrollParent = null;
		}
		touchDragChatId = null;
		dragChatId = null;
		dragOverChatId = null;
	}

	function handleTouchMove(e: TouchEvent) {
		// If the long press hasn't fired yet and the finger moves more than 10px,
		// it's a scroll, not a drag. Cancel.
		if (!touchDragChatId && touchLongPressTimer) {
			const dy = Math.abs(e.touches[0].clientY - touchStartY);
			if (dy > 10) {
				clearTimeout(touchLongPressTimer);
				touchLongPressTimer = null;
			}
			return;
		}

		if (!touchDragChatId) return;
		e.preventDefault();
		// RAF-coalesce hit-testing: touchmove fires up to ~120 Hz on modern
		// devices but we only ever paint once per frame, and elementsFromPoint
		// + the DOM walk below is the expensive part. Cache the latest touch
		// point and let the next frame consume it.
		latestTouchX = e.touches[0].clientX;
		latestTouchY = e.touches[0].clientY;
		if (touchMoveRaf == null) {
			touchMoveRaf = requestAnimationFrame(() => {
				touchMoveRaf = null;
				processTouchMove();
			});
		}
	}

	function processTouchMove() {
		if (!touchDragChatId) return;
		const cx = latestTouchX;
		const cy = latestTouchY;
		const elements = document.elementsFromPoint(cx, cy);
		let found = false;
		for (const el of elements) {
			const chatEl = (el as HTMLElement).closest('[data-pinned-chat-id]') as HTMLElement | null;
			if (chatEl) {
				const overId = Number(chatEl.dataset.pinnedChatId);
				if (overId !== touchDragChatId) {
					dragOverChatId = overId;
					dropPosition = getDropPosition(cy, chatEl);
				}
				found = true;
				break;
			}
		}

		// If not over a pinned chat, snap to nearest (first/last).
		if (!found) {
			const allPinned = document.querySelectorAll('[data-pinned-chat-id]');
			if (allPinned.length > 0) {
				const firstEl = allPinned[0] as HTMLElement;
				const lastEl = allPinned[allPinned.length - 1] as HTMLElement;
				const firstRect = firstEl.getBoundingClientRect();
				const lastRect = lastEl.getBoundingClientRect();
				const firstId = Number(firstEl.dataset.pinnedChatId);
				const lastId = Number(lastEl.dataset.pinnedChatId);

				if (cy < firstRect.top + firstRect.height / 2) {
					if (firstId !== touchDragChatId) {
						dragOverChatId = firstId;
						dropPosition = 'above';
					}
				} else if (cy > lastRect.top + lastRect.height / 2) {
					if (lastId !== touchDragChatId) {
						dragOverChatId = lastId;
						dropPosition = 'below';
					}
				}
			}
		}
	}

	function handleTouchEnd() {
		if (touchLongPressTimer) {
			clearTimeout(touchLongPressTimer);
			touchLongPressTimer = null;
		}
		if (touchMoveRaf != null) {
			cancelAnimationFrame(touchMoveRaf);
			touchMoveRaf = null;
		}
		if (touchScrollParent) {
			touchScrollParent.style.overflowY = '';
			touchScrollParent = null;
		}
		const fromId = touchDragChatId;
		const toId = dragOverChatId;
		const pos = dropPosition;
		touchDragChatId = null;
		dragChatId = null;
		dragOverChatId = null;
		if (fromId && toId) performReorder(fromId, toId, pos);
	}

	return {
		get dragChatId() {
			return dragChatId;
		},
		get dragOverChatId() {
			return dragOverChatId;
		},
		get dropPosition() {
			return dropPosition;
		},
		get touchDragChatId() {
			return touchDragChatId;
		},
		get pinOrderOverrides() {
			return pinOrderOverrides;
		},
		// desktop
		handleDragStart,
		handleDragOver,
		handleDrop,
		handleDragEnd,
		handlePinnedRowDragOver,
		handlePinnedRowDrop,
		handlePinnedContainerDragOver,
		handlePinnedContainerDrop,
		handleNavDragOver,
		handleNavDrop,
		// touch
		handleTouchStart,
		handleTouchMove,
		handleTouchEnd,
		handleTouchCancel,
		// imperative API for code outside the drag flow (togglePin, keyboard
		// move, etc.) — keeps optimistic ordering consistent.
		performReorder,
		setPinOrderOverride(chatId: number, value: number) {
			pinOrderOverrides = new Map(pinOrderOverrides ?? []);
			pinOrderOverrides.set(chatId, value);
		},
		clearPinOrderOverride(chatId: number) {
			if (!pinOrderOverrides?.has(chatId)) return;
			const next = new Map(pinOrderOverrides);
			next.delete(chatId);
			pinOrderOverrides = next.size > 0 ? next : null;
		}
	};
}
