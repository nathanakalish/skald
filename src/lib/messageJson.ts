// Centralised parsers for the JSON-encoded array columns on `messages`
// (`swipes`, `reasoning`). Previously parsed inline at 11+ call sites, each
// with slightly different try/catch + default handling. A malformed row now
// degrades the same way everywhere: returns an empty array, never throws.
//
// Note: we deliberately don't log here — one bad row would spam logs on every
// read. The caller has more context to decide if absence is worth surfacing.

function parseJsonArray(raw: string | null | undefined): unknown[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Parse a `messages.swipes` JSON column to a string[]. Empty on error/null. */
export function parseSwipes(raw: string | null | undefined): string[] {
	return parseJsonArray(raw).filter((v): v is string => typeof v === 'string');
}

/** Parse a `messages.reasoning` JSON column to a string[]. Empty on error/null. */
export function parseReasoning(raw: string | null | undefined): string[] {
	return parseJsonArray(raw).filter((v): v is string => typeof v === 'string');
}
