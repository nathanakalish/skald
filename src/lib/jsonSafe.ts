// Shared safe-parse helpers for JSON-encoded DB columns and untrusted blobs.
// All parsers swallow JSON errors and type mismatches and return a defined,
// typed default — never throw, never log (caller has context for that).
//
// Use this instead of bare `JSON.parse(... || '[]')` anywhere a row could
// theoretically be corrupt: malformed import, manual DB edit, version skew.
// `messageJson.ts` keeps its own thin wrappers for the message swipes /
// reasoning columns; both files share the same defensive shape.

function tryParse(raw: string | null | undefined): unknown {
	if (raw == null || raw === '') return undefined;
	try { return JSON.parse(raw); } catch { return undefined; }
}

/** Parse a JSON string into `string[]`. Filters non-strings. Empty on error. */
export function parseStringArray(raw: string | null | undefined): string[] {
	const v = tryParse(raw);
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Parse a JSON string into a plain object. Rejects arrays/null/primitives.
 * Returns `{}` on error so callers can splat safely.
 */
export function parseRecord(raw: string | null | undefined): Record<string, unknown> {
	const v = tryParse(raw);
	if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
	return v as Record<string, unknown>;
}

/**
 * Parse a JSON string and validate with a caller-supplied predicate.
 * Returns the fallback when parse fails OR the predicate rejects the shape.
 */
export function parseValidated<T>(
	raw: string | null | undefined,
	guard: (v: unknown) => v is T,
	fallback: T
): T {
	const v = tryParse(raw);
	return guard(v) ? v : fallback;
}
