import { haptic } from '$lib/utils/haptics';

/**
 * Long-press / right-click context menu opener for a single button. Coordinates
 * the three event paths a "press-and-hold" menu has to deal with:
 *
 *   1. The synthetic click that fires on pointerup after the long-press timer
 *      already opened the menu — would otherwise re-trigger the button's
 *      primary onclick.
 *   2. That same click bubbling up to a document-level click-outside listener,
 *      which would immediately close the menu we just opened.
 *   3. Right-click (oncontextmenu) — no follow-up click, so the "swallow next
 *      click" flag must not stay armed.
 *
 * Uses a flag instead of a time window because the user can hold the button
 * arbitrarily long after the menu opens. Wire it up like:
 *
 *   const handlers = createButtonLongPress((x, y) => openMenu(x, y));
 *   <button
 *     onclick={(e) => { if (handlers.suppressClick()) { e.preventDefault(); e.stopPropagation(); return; } handleClick(); }}
 *     onpointerdown={handlers.onpointerdown}
 *     onpointermove={handlers.onpointermove}
 *     onpointerup={handlers.onpointerup}
 *     onpointercancel={handlers.onpointercancel}
 *     oncontextmenu={handlers.oncontextmenu}
 *   />
 *
 * And from a document click-outside listener: `if (handlers.isSuppressing()) return;`
 */
export interface ButtonLongPressHandlers {
	onpointerdown(e: PointerEvent): void;
	onpointermove(e: PointerEvent): void;
	onpointerup(): void;
	onpointercancel(): void;
	oncontextmenu(e: MouseEvent): void;
	/** Call from button's own onclick — returns true (and consumes flag) if click was synthetic-after-long-press. */
	suppressClick(): boolean;
	/** Call from document click-outside listener — peeks without consuming. */
	isSuppressing(): boolean;
	reset(): void;
}

export interface CreateButtonLongPressOpts {
	/** ms before long-press fires. Default 500. */
	holdMs?: number;
	/** Pointer drift in px that cancels the long-press. Default 8. */
	moveTolerance?: number;
	/** Haptic strength on trigger. Pass null to skip. Default 'medium'. */
	hapticStrength?: 'light' | 'medium' | 'heavy' | null;
}

export function createButtonLongPress(
	open: (x: number, y: number) => void,
	opts: CreateButtonLongPressOpts = {}
): ButtonLongPressHandlers {
	const holdMs = opts.holdMs ?? 500;
	const moveTolerance = opts.moveTolerance ?? 8;
	const hapticStrength = opts.hapticStrength === undefined ? 'medium' : opts.hapticStrength;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let start = { x: 0, y: 0 };
	let pending = false;
	const trigger = (x: number, y: number) => {
		pending = true;
		if (hapticStrength) haptic(hapticStrength);
		open(x, y);
	};
	return {
		onpointerdown(e) {
			if (e.button !== 0) return;
			start = { x: e.clientX, y: e.clientY };
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				trigger(start.x, start.y);
			}, holdMs);
		},
		onpointermove(e) {
			if (!timer) return;
			if (Math.abs(e.clientX - start.x) > moveTolerance || Math.abs(e.clientY - start.y) > moveTolerance) {
				clearTimeout(timer);
				timer = null;
			}
		},
		onpointerup() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
		onpointercancel() {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			pending = false;
		},
		oncontextmenu(e) {
			e.preventDefault();
			e.stopPropagation();
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			trigger(e.clientX, e.clientY);
			pending = false;
		},
		suppressClick() {
			if (!pending) return false;
			pending = false;
			return true;
		},
		isSuppressing() {
			if (!pending) return false;
			pending = false;
			return true;
		},
		reset() {
			pending = false;
		}
	};
}
