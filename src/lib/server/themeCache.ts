/**
 * Per-user active-theme cache.
 *
 * The root layout / hooks.server.ts resolves the active theme on every page
 * navigation. With Phase 3 indexes that's two sub-millisecond queries per
 * render — the value almost never changes, so we cache it.
 *
 * Cache key: userId. Value: the resolved theme row (or null when no custom
 * theme is selected). Bounded at LRU_MAX so a sea of users can't grow the
 * map unboundedly.
 *
 * Invalidation: callers must call
 *   - invalidateForUser(userId) when they change the user's activeThemeId
 *   - invalidateForTheme(themeId) when a theme is mutated/deleted (we don't
 *     track which users had it active, so we sweep — cheap because the map
 *     is bounded)
 */
import type { themes } from '$lib/db/schema.js';

type ThemeRow = typeof themes.$inferSelect | null;

interface Entry {
	value: ThemeRow;
	touched: number;
}

const LRU_MAX = 100;
const cache = new Map<number, Entry>();

export function get(userId: number): ThemeRow | undefined {
	const entry = cache.get(userId);
	if (!entry) return undefined;
	entry.touched = Date.now();
	// Re-insert to keep LRU ordering (Map preserves insertion order).
	cache.delete(userId);
	cache.set(userId, entry);
	return entry.value;
}

export function set(userId: number, value: ThemeRow): void {
	if (cache.has(userId)) cache.delete(userId);
	cache.set(userId, { value, touched: Date.now() });
	// Evict the oldest until we're back under the cap.
	while (cache.size > LRU_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

export function invalidateForUser(userId: number): void {
	cache.delete(userId);
}

export function invalidateForTheme(themeId: number): void {
	for (const [userId, entry] of cache) {
		if (entry.value && entry.value.id === themeId) {
			cache.delete(userId);
		}
	}
}
