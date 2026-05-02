/**
 * Creates a modal visibility state that supports exit animations.
 * When `open` transitions from true to false, `visible` stays true for the
 * duration of the exit animation before becoming false.
 */
export function createModalState(getOpen: () => boolean) {
	let visible = $state(false);
	let closing = $state(false);
	let gestureClose = $state(false);

	$effect(() => {
		const open = getOpen();
		if (open) {
			visible = true;
			closing = false;
			gestureClose = false;
		} else if (visible) {
			if (gestureClose) {
				// Gesture already handled the visual exit — skip animation
				visible = false;
				closing = false;
				gestureClose = false;
			} else {
				closing = true;
				const timer = setTimeout(() => {
					visible = false;
					closing = false;
				}, 150);
				return () => clearTimeout(timer);
			}
		}
	});

	return {
		get visible() { return visible; },
		get closing() { return closing; },
		/** Call before onclose() to skip the CSS exit animation (gesture handled it). */
		setGestureClose() { gestureClose = true; },
	};
}

/**
 * Creates touch gesture state for modals:
 * - Pull-down to dismiss with smooth slide animation (respects scroll position)
 * - Horizontal swipe to switch tabs (touch-tracked with snap)
 *
 * Exposes `panelStyle` (for the modal panel div) and `contentStyle`/`contentClass`
 * (for the tab content wrapper in tabbed modals).
 */
export function createModalGestures(opts: {
	onclose: () => void;
	modal: ReturnType<typeof createModalState>;
	tabs?: { ids: () => string[]; active: () => string; set: (id: string) => void };
}) {
	let dragY = $state(0);
	let draggingDown = $state(false);
	let dismissing = $state(false);
	let pullSettling = $state(false);

	let swipeX = $state(0);
	let swiping = $state(false);
	let swipeSettling = $state(false);
	let swipeEnterFrom = $state<'left' | 'right' | null>(null);

	let startX = 0;
	let startY = 0;
	let intent: 'none' | 'swipe' | 'pull' | 'scroll' = 'none';
	let scrollEl: HTMLElement | null = null;

	function onTouchStart(e: TouchEvent) {
		if (dismissing) return;
		const t = e.touches[0];
		startX = t.clientX;
		startY = t.clientY;
		intent = 'none';
		scrollEl = findScrollParent(e.target as HTMLElement);
		// Reset lingering state
		dragY = 0;
		draggingDown = false;
		pullSettling = false;
		swipeX = 0;
		swiping = false;
		swipeSettling = false;
		swipeEnterFrom = null;
	}

	function onTouchMove(e: TouchEvent) {
		if (dismissing) return;
		const t = e.touches[0];
		const dx = t.clientX - startX;
		const dy = t.clientY - startY;

		if (intent === 'none') {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			if (Math.abs(dx) > Math.abs(dy) && opts.tabs) {
				intent = 'swipe';
			} else if (dy > 0 && (!scrollEl || scrollEl.scrollTop <= 0)) {
				intent = 'pull';
			} else {
				intent = 'scroll';
			}
		}

		if (intent === 'swipe') {
			e.preventDefault();
			swiping = true;
			// Rubber band at edges (first/last tab)
			const ids = opts.tabs!.ids();
			const idx = ids.indexOf(opts.tabs!.active());
			if ((dx < 0 && idx === ids.length - 1) || (dx > 0 && idx === 0)) {
				swipeX = dx * 0.3;
			} else {
				swipeX = dx;
			}
		} else if (intent === 'pull') {
			e.preventDefault();
			draggingDown = true;
			dragY = Math.max(0, dy * 0.6);
		}
	}

	function onTouchEnd() {
		if (dismissing) return;

		if (intent === 'swipe' && opts.tabs) {
			const ids = opts.tabs.ids();
			const current = opts.tabs.active();
			const idx = ids.indexOf(current);

			if (swipeX < -50 && idx < ids.length - 1) {
				opts.tabs.set(ids[idx + 1]);
				swipeEnterFrom = 'right';
				swipeX = 0;
				swiping = false;
				setTimeout(() => { swipeEnterFrom = null; }, 250);
			} else if (swipeX > 50 && idx > 0) {
				opts.tabs.set(ids[idx - 1]);
				swipeEnterFrom = 'left';
				swipeX = 0;
				swiping = false;
				setTimeout(() => { swipeEnterFrom = null; }, 250);
			} else {
				// Snap back
				swipeSettling = true;
				swipeX = 0;
				swiping = false;
				setTimeout(() => { swipeSettling = false; }, 200);
			}
		}

		if (intent === 'pull') {
			if (dragY > 100) {
				// Dismiss: slide off-screen then close
				dismissing = true;
				dragY = window.innerHeight;
				setTimeout(() => {
					opts.modal.setGestureClose();
					opts.onclose();
					dragY = 0;
					draggingDown = false;
					dismissing = false;
				}, 300);
			} else {
				// Snap back with transition
				pullSettling = true;
				dragY = 0;
				setTimeout(() => {
					draggingDown = false;
					pullSettling = false;
				}, 200);
			}
		}

		intent = 'none';
	}

	return {
		/** Style for the modal panel div (pull-down tracking + dismiss). */
		get panelStyle() {
			if (!draggingDown) return '';
			const transition = dismissing
				? 'transform 300ms ease-out'
				: pullSettling
				? 'transform 200ms ease-out'
				: 'none';
			return `transform: translateY(${dragY}px); transition: ${transition}`;
		},
		/** Style for the tab content wrapper (horizontal swipe tracking). */
		get contentStyle() {
			if (swiping) return `transform: translateX(${swipeX}px); transition: none`;
			if (swipeSettling) return `transform: translateX(0); transition: transform 200ms ease-out`;
			return '';
		},
		/** CSS class for the tab content wrapper (enter animation after tab switch). */
		get contentClass() {
			if (swipeEnterFrom === 'left') return 'tab-enter-from-left';
			if (swipeEnterFrom === 'right') return 'tab-enter-from-right';
			return '';
		},
		handlers: { onTouchStart, onTouchMove, onTouchEnd },
	};
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
	while (el) {
		if (el.scrollHeight > el.clientHeight + 1) {
			const style = getComputedStyle(el);
			if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
		}
		el = el.parentElement;
	}
	return null;
}
