/**
 * Tiny shared validators for request handlers.
 *
 * The point isn't business validation — most of that lives next to the route
 * itself — it's just to keep the "did the client send something pathologically
 * huge?" boilerplate in one place so we don't accidentally accept a 200MB
 * string straight into SQLite.
 */

export const MAX_MESSAGE_CHARS = 200_000;
export const MAX_FIELD_CHARS = 50_000;
export const MAX_NAME_CHARS = 500;

export function tooLong(value: unknown, max: number): boolean {
	return typeof value === 'string' && value.length > max;
}

/**
 * Returns an error object if the value is over the cap, else null. Caller
 * decides what to do (typically `return json(err, { status: 400 })`).
 */
export function lengthError(field: string, value: unknown, max: number): { error: string } | null {
	if (tooLong(value, max)) {
		return { error: `${field} too long (max ${max} characters)` };
	}
	return null;
}
