// Lightweight haptic feedback. Respects the `reduceMotion` user setting and
// silently no-ops on platforms without the Vibration API (iOS Safari).
//
// Use sparingly — only for actions that have a clear physical metaphor
// (long-press, successful discrete action, swipe commit). Avoid firing on
// hover, scroll, or continuous streams.

import { settingsStore } from '$lib/stores/settings.svelte.js';

type Pattern = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

const PATTERNS: Record<Pattern, number | number[]> = {
	light: 8,
	medium: 14,
	heavy: 22,
	selection: 5,
	success: [10, 40, 10],
	warning: [20, 60, 20],
	error: [30, 80, 30, 80, 30]
};

export function haptic(pattern: Pattern = 'light'): void {
	if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
	if (settingsStore.settings.reduceMotion) return;
	try {
		navigator.vibrate(PATTERNS[pattern]);
	} catch {
		// Best-effort; some browsers throw when called rapidly.
	}
}
