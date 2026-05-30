/**
 * Negative-ID generator for optimistic message placeholders.
 *
 * Real DB ids are positive, so negatives never collide with persisted rows.
 * Older code used `Date.now()` / `Date.now()+1` which collided in fast loops
 * (back-to-back sends within the same millisecond, tight test cases). A
 * monotonic counter keyed off Date.now() gives uniqueness even at machine
 * speed while staying roughly time-ordered for readability in dev tools.
 */
export interface PlaceholderIdSeq {
	next(): number;
}

export function createPlaceholderIdSeq(seed: number = Date.now()): PlaceholderIdSeq {
	let n = -Math.abs(seed);
	return {
		next() {
			return --n;
		}
	};
}

export function isPlaceholderId(id: number): boolean {
	return id < 0;
}
