/**
 * Server-side validator. Re-exports the shared FIELD_LIMITS so existing
 * `$lib/server/fieldLimits` imports keep working, and adds the request-time
 * length check used by API routes.
 *
 * If the admin has disabled `characterLimitsEnabled`, this becomes a no-op —
 * the client UI and the server enforcement turn off together so the toggle
 * has the symmetric effect an admin expects.
 */

import { json } from '@sveltejs/kit';
import { FIELD_LIMITS, type FieldLimitKey } from '../fieldLimits.js';
import { getAdminSettingBool } from './adminSettings.js';

export { FIELD_LIMITS };
export type { FieldLimitKey };

export interface LengthViolation {
	field: string;
	limitKey: FieldLimitKey;
	limit: number;
	length: number;
}

/**
 * Are field-length limits being enforced right now? Imports respect the same
 * admin toggle as the REST endpoints — flipping it off disables both at once.
 */
export function fieldLimitsEnabled(): boolean {
	return getAdminSettingBool('characterLimitsEnabled');
}

/**
 * Walk `checks` and return the first field that exceeds its configured limit,
 * or `null` if everything is within bounds. Non-string and missing fields are
 * skipped (caller handles required-ness).
 */
export function findLengthViolation(
	body: Record<string, unknown> | null | undefined,
	checks: Partial<Record<string, FieldLimitKey>>,
): LengthViolation | null {
	if (!body) return null;
	if (!fieldLimitsEnabled()) return null;
	for (const [field, limitKey] of Object.entries(checks)) {
		if (!limitKey) continue;
		const value = body[field];
		if (typeof value !== 'string') continue;
		const limit = FIELD_LIMITS[limitKey];
		if (value.length > limit) {
			return { field, limitKey, limit, length: value.length };
		}
	}
	return null;
}

/**
 * Validate that each provided string field is within its configured maximum.
 * Returns a 400 JSON Response on violation, or `null` if all checks pass.
 */
export function validateLengths(
	body: Record<string, unknown> | null | undefined,
	checks: Partial<Record<string, FieldLimitKey>>,
): Response | null {
	const v = findLengthViolation(body, checks);
	if (!v) return null;
	return json(
		{ error: `Field "${v.field}" exceeds maximum length of ${v.limit} characters` },
		{ status: 400 },
	);
}

/**
 * Check a single string against a limit. Returns the violation details or
 * `null` if within bounds (or limits disabled). Convenient for bulk-import
 * loops that want to surface or skip oversized entries individually.
 */
export function checkLength(value: unknown, limitKey: FieldLimitKey, field = String(limitKey)): LengthViolation | null {
	if (!fieldLimitsEnabled()) return null;
	if (typeof value !== 'string') return null;
	const limit = FIELD_LIMITS[limitKey];
	if (value.length <= limit) return null;
	return { field, limitKey, limit, length: value.length };
}
