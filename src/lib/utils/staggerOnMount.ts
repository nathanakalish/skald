// Svelte action that snapshots an `enabled` boolean at mount time. When
// enabled, the `chat-item-stagger` CSS class (and the `--stagger` variable
// based on `index`) are applied — but only on the initial mount. The class
// never gets re-evaluated reactively, so an item mounting during a layout
// transition (when `enabled` is false) won't play the stagger animation.
//
// Just as importantly, the class gets removed as soon as the keyframe
// finishes (animationend, with a setTimeout safety net). Otherwise a later
// layout-transitioning override (animation: none !important) would clear
// the in-flight animation, and removing the override would re-attach the
// rule and replay the keyframe from frame 0 — which is exactly the
// "delayed entrance" bug we're fighting.

import { layoutTransitionState } from './layoutTransition';

export function staggerOnMount(
	node: HTMLElement,
	params: { enabled?: boolean; index?: number; max?: number; step?: number } = {}
) {
	const { enabled = true, index = 0, step = 30, max = 300 } = params;
	const ok = enabled && !layoutTransitionState.value;

	let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
	const cleanup = () => {
		node.classList.remove('chat-item-stagger');
		node.style.removeProperty('--stagger');
		node.style.removeProperty('opacity');
		node.removeEventListener('animationend', onEnd);
		if (cleanupTimer) {
			clearTimeout(cleanupTimer);
			cleanupTimer = null;
		}
	};
	const onEnd = (e: AnimationEvent) => {
		// Multiple animations may run on the node; only react to slide-up.
		if (e.animationName && e.animationName !== 'slide-up') return;
		cleanup();
	};

	if (ok) {
		const delay = Math.min(index * step, max);
		node.style.setProperty('--stagger', `${delay}ms`);
		node.classList.add('chat-item-stagger');
		node.addEventListener('animationend', onEnd);
		// Safety net in case animationend never fires (animation suppressed,
		// reduceMotion, page hidden, etc.). slide-up is 250ms, so 600ms past
		// the delay is comfortably past the end.
		cleanupTimer = setTimeout(cleanup, delay + 600);
	}

	return {
		update() {},
		destroy() {
			if (cleanupTimer) clearTimeout(cleanupTimer);
			node.removeEventListener('animationend', onEnd);
		}
	};
}
