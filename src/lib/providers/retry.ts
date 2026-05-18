// Tiny one-shot retry-with-jitter wrapper for idempotent provider calls
// (model listing, connection tests). NOT for use on chat completions —
// retrying a partial stream silently re-bills the user.
//
// One retry is the right knob: transient 5xx / network hiccups go away on
// retry; persistent errors (401, 404, bad endpoint) fail fast on the second
// attempt and surface the real message.

export interface RetryOptions {
	/** Base delay in ms; actual delay is base + random(0..base). */
	baseDelayMs?: number;
	/** Predicate deciding whether an error is worth retrying. */
	shouldRetry?: (err: unknown) => boolean;
}

// 4xx (except 429) are client errors — retrying won't help. 5xx, 429, and
// network errors (no status) are worth one retry.
function defaultShouldRetry(err: unknown): boolean {
	if (!err) return false;
	const msg = String((err as Error)?.message ?? err);
	// fetch / undici throws with no status — assume transient.
	if (/network|ECONN|ETIMEDOUT|fetch failed|socket hang up/i.test(msg)) return true;
	const statusMatch = msg.match(/\b(\d{3})\b/);
	if (!statusMatch) return false;
	const status = Number(statusMatch[1]);
	return status === 429 || status >= 500;
}

export async function retryOnce<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
	const base = opts.baseDelayMs ?? 250;
	const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
	try {
		return await fn();
	} catch (err) {
		if (!shouldRetry(err)) throw err;
		const delay = base + Math.floor(Math.random() * base);
		await new Promise((resolve) => setTimeout(resolve, delay));
		return await fn();
	}
}
