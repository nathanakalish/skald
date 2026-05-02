/**
 * Simple in-memory rate limiter keyed by an arbitrary string (IP, "u:<id>:<path>", etc.).
 * Tracks sliding-window attempt counts per key. Map size is capped to bound memory.
 */

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/** Hard cap on number of distinct keys tracked — bounds memory under abuse. */
const MAX_KEYS = 50_000;

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (entry.resetAt <= now) store.delete(key);
	}
}, 5 * 60 * 1000).unref();

/**
 * Check rate limit for a given key (typically IP address or "u:<id>:<path>").
 * Returns { allowed, retryAfterSeconds }.
 */
export function checkRateLimit(
	key: string,
	maxAttempts = 10,
	windowMs = 60 * 1000
): { allowed: boolean; retryAfterSeconds: number } {
	const now = Date.now();
	const entry = store.get(key);

	if (!entry || entry.resetAt <= now) {
		// If we're at the cap, evict the oldest entry (Map preserves insertion order;
		// new entries go to the end so the front is the oldest).
		if (store.size >= MAX_KEYS) {
			const firstKey = store.keys().next().value as string | undefined;
			if (firstKey !== undefined) store.delete(firstKey);
		}
		store.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, retryAfterSeconds: 0 };
	}

	entry.count++;
	if (entry.count > maxAttempts) {
		const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
		return { allowed: false, retryAfterSeconds };
	}

	return { allowed: true, retryAfterSeconds: 0 };
}
