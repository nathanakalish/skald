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

/**
 * Validate that each provided string field is within its configured maximum.
 * Returns a 400 JSON Response on violation, or `null` if all checks pass.
 * Non-string and missing fields are skipped (caller handles required-ness).
 */
export function validateLengths(
	body: Record<string, unknown> | null | undefined,
	checks: Partial<Record<string, FieldLimitKey>>,
): Response | null {
	if (!body) return null;
	if (!getAdminSettingBool('characterLimitsEnabled')) return null;
	for (const [field, limitKey] of Object.entries(checks)) {
		if (!limitKey) continue;
		const value = body[field];
		if (typeof value !== 'string') continue;
		const limit = FIELD_LIMITS[limitKey];
		if (value.length > limit) {
			return json(
				{ error: `Field "${field}" exceeds maximum length of ${limit} characters` },
				{ status: 400 },
			);
		}
	}
	return null;
}
