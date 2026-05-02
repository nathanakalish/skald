/**
 * Owns the mobile sidebar swipe-to-open / drag-to-close gesture:
 *   - tracks `touchX` (current translateX offset while dragging) and
 *     `dragging` (whether we're committed to a horizontal gesture)
 *   - on touchend, snaps mobileOpen open/closed based on a 35% threshold
 *   - bails out when the user is interacting with a modal, a no-swipe region
 *     (e.g. horizontally-scrollable pinned-chats row), or a pinned-chat
 *     reorder is in progress.
 *
 * Caller hands us reactive accessors (so the composable always sees the latest
 * `isMobile` / `mobileOpen` without prop-drilling) and a setter for `mobileOpen`.
 *
 * Lifted out of `+layout.svelte` (~110 lines).
 */

interface CreateMobileSidebarGesturesOptions {
	getIsMobile: () => boolean;
	getMobileOpen: () => boolean;
	setMobileOpen: (v: boolean) => void;
	/** Returns true if the user is currently long-press-reordering a pinned chat. */
	isReordering: () => boolean;
}

export function createMobileSidebarGestures({
	getIsMobile,
	getMobileOpen,
	setMobileOpen,
	isReordering
}: CreateMobileSidebarGesturesOptions) {
	let touchX = $state<number | null>(null); // null = not dragging
	let dragging = $state(false);

	$effect(() => {
		if (!getIsMobile()) return;

		let startX = 0;
		let startY = 0;
		let tracking = false;
		let direction: 'open' | 'close' | null = null;
		let committed = false;
		let sidebarEl: HTMLElement | null = null;

		const maxOffset = () => {
			sidebarEl = document.querySelector('[data-mobile-sidebar]') as HTMLElement;
			return sidebarEl?.offsetWidth ?? 320;
		};

		const onTouchStart = (e: TouchEvent) => {
			// Hands off if a modal is up.
			if ((e.target as HTMLElement)?.closest?.('[role="dialog"]')) return;
			// Hands off horizontally-scrollable areas inside the sidebar.
			if (getMobileOpen() && (e.target as HTMLElement)?.closest?.('[data-no-sidebar-swipe]')) return;
			const touch = e.touches[0];
			committed = false;
			if (!getMobileOpen() && touch.clientX < 30) {
				// Opening: only if the finger started near the left edge.
				startX = touch.clientX;
				startY = touch.clientY;
				tracking = true;
				direction = 'open';
			} else if (getMobileOpen()) {
				// Closing: anywhere is fair game.
				startX = touch.clientX;
				startY = touch.clientY;
				tracking = true;
				direction = 'close';
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!tracking) return;
			// Don't fight with pinned-chat reordering.
			if (isReordering()) {
				tracking = false;
				return;
			}
			const touch = e.touches[0];
			const dx = touch.clientX - startX;
			const dy = Math.abs(touch.clientY - startY);

			// Demand horizontal intent before committing.
			if (!committed) {
				if (Math.abs(dx) < 10 && dy < 10) return;
				if (dy > Math.abs(dx)) {
					tracking = false;
					return;
				}
				committed = true;
				dragging = true;
				// Blur the focused input so the on-screen keyboard goes away while
				// the sidebar slides in. Otherwise the page stays shrunk to the
				// visual viewport above the keyboard and the drawer ends up
				// squeezed into that smaller area. Looks awful.
				const active = document.activeElement as HTMLElement | null;
				if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
					active.blur();
				}
			}

			// Block background scroll while we're dragging the sidebar.
			e.preventDefault();

			const width = maxOffset();
			if (direction === 'open') {
				// translateX runs from -width (hidden) to 0 (fully open).
				touchX = Math.max(-width, Math.min(0, -width + touch.clientX));
			} else {
				// translateX runs from 0 (open) to -width (hidden).
				touchX = Math.max(-width, Math.min(0, dx));
			}
		};

		const onTouchEnd = () => {
			if (!tracking || !committed) {
				tracking = false;
				return;
			}
			tracking = false;
			const width = maxOffset();
			const offset = touchX ?? 0;
			const threshold = width * 0.35;

			if (direction === 'open') {
				setMobileOpen(offset > -width + threshold);
			} else {
				setMobileOpen(offset > -threshold);
			}
			touchX = null;
			dragging = false;
			direction = null;
		};

		document.addEventListener('touchstart', onTouchStart, { passive: true });
		document.addEventListener('touchmove', onTouchMove, { passive: false });
		document.addEventListener('touchend', onTouchEnd, { passive: true });
		return () => {
			document.removeEventListener('touchstart', onTouchStart);
			document.removeEventListener('touchmove', onTouchMove);
			document.removeEventListener('touchend', onTouchEnd);
		};
	});

	return {
		get touchX() {
			return touchX;
		},
		get dragging() {
			return dragging;
		}
	};
}
