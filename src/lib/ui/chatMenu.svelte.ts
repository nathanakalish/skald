/**
 * Owns the per-chat-row "more" menu (right-click on desktop / long-press on
 * mobile) and its lifecycle:
 *   - menu open state + computed position (with viewport flip-up)
 *   - long-press detection on touch
 *   - close-on-outside-click / scroll / Escape via a $effect that lives on
 *     the composable and only attaches listeners while open
 *
 * Pulled out of `+layout.svelte` (~95 lines that were getting awkward in there).
 */
import { haptic } from '$lib/utils/haptics.js';

const MENU_W = 192; // matches w-48
const MENU_H = 260; // worst case w/ all items

interface MenuPosition {
	x: number;
	y: number;
	flipUp: boolean;
}

export function createChatMenu() {
	let openChatId = $state<number | null>(null);
	let position = $state<MenuPosition | null>(null);

	// Long-press state (touch only) — kept private; consumers just call
	// startLongPress/moveLongPress/endLongPress from touch events.
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressStart = { x: 0, y: 0 };
	let longPressFired = $state(false);
	let suppressNextClick = false;

	function close() {
		openChatId = null;
		position = null;
	}

	function open(chatId: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		// For right-click, anchor at cursor; otherwise (the ⋯ button) anchor at button.
		let anchorX: number;
		let anchorY: number;
		let flipUp = false;
		if (e.type === 'contextmenu') {
			anchorX = e.clientX;
			anchorY = e.clientY;
			flipUp = anchorY + MENU_H > winH;
		} else {
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			flipUp = rect.bottom + MENU_H > winH;
			anchorX = rect.right;
			anchorY = flipUp ? rect.top - 8 : rect.bottom + 4;
		}
		const x = Math.max(8, Math.min(winW - MENU_W - 8, anchorX - MENU_W));
		const y = flipUp
			? Math.max(MENU_H + 8, Math.min(winH - 8, anchorY))
			: Math.max(8, Math.min(winH - MENU_H - 8, anchorY));
		position = { x, y, flipUp };
		openChatId = chatId;
	}

	function openAtPoint(chatId: number, clientX: number, clientY: number) {
		const winW = window.innerWidth;
		const winH = window.innerHeight;
		const x = Math.max(8, Math.min(winW - MENU_W - 8, clientX - MENU_W / 2));
		const flipUp = clientY + MENU_H > winH;
		const rawY = flipUp ? clientY - 8 : clientY + 8;
		const y = flipUp
			? Math.max(MENU_H + 8, Math.min(winH - 8, rawY))
			: Math.max(8, Math.min(winH - MENU_H - 8, rawY));
		position = { x, y, flipUp };
		openChatId = chatId;
	}

	function startLongPress(chatId: number, e: TouchEvent) {
		const t = e.touches[0];
		longPressStart = { x: t.clientX, y: t.clientY };
		longPressFired = false;
		if (longPressTimer) clearTimeout(longPressTimer);
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			longPressFired = true;
			haptic('medium');
			openAtPoint(chatId, longPressStart.x, longPressStart.y);
		}, 500);
	}

	function moveLongPress(e: TouchEvent) {
		if (!longPressTimer) return;
		const t = e.touches[0];
		const dx = Math.abs(t.clientX - longPressStart.x);
		const dy = Math.abs(t.clientY - longPressStart.y);
		if (dx > 10 || dy > 10) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function endLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		if (longPressFired) {
			// Swallow the synthesized click that follows touchend so the
			// just-opened menu doesn't immediately close, and the underlying
			// chat row doesn't open.
			suppressNextClick = true;
			setTimeout(() => {
				suppressNextClick = false;
				longPressFired = false;
			}, 500);
		}
	}

	// Auto-close lifecycle: only attach document-level listeners while open.
	$effect(() => {
		if (openChatId === null) return;
		const onDoc = (e: MouseEvent) => {
			if (suppressNextClick) {
				suppressNextClick = false;
				return;
			}
			if (!(e.target as HTMLElement).closest('[data-chat-menu]')) close();
		};
		const onScroll = () => close();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		// Defer so the same click that opened the menu doesn't immediately close it.
		const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
		document.addEventListener('scroll', onScroll, true);
		document.addEventListener('keydown', onKey);
		return () => {
			clearTimeout(t);
			document.removeEventListener('click', onDoc);
			document.removeEventListener('scroll', onScroll, true);
			document.removeEventListener('keydown', onKey);
		};
	});

	return {
		get openChatId() {
			return openChatId;
		},
		get position() {
			return position;
		},
		get longPressFired() {
			return longPressFired;
		},
		open,
		openAtPoint,
		close,
		startLongPress,
		moveLongPress,
		endLongPress
	};
}
