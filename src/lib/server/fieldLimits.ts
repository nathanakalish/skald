/**
 * Server-side maximum length caps for user-supplied text fields. SQLite stores
 * unbounded TEXT, so without these the API would happily accept multi-megabyte
 * names or descriptions — which then break list rendering, blow up exports, and
 * make rate-limit/payload guards (M14) the only line of defense.
 *
 * Limits are deliberately generous: they exist to stop pathological abuse
 * (paste-a-novel-into-a-name), not to police normal use.
 */

import { json } from '@sveltejs/kit';

export const FIELD_LIMITS = {
	// short identifiers
	name: 200,
	username: 64,
	tagLine: 500,
	url: 2048,
	// medium prose
	description: 10_000,
	scenario: 10_000,
	personality: 10_000,
	creatorNotes: 5_000,
	tags: 2_000,
	// long prose / templates
	systemPrompt: 50_000,
	prompt: 50_000,
	firstMessage: 50_000,
	mesExample: 50_000,
	postHistoryInstructions: 20_000,
	greeting: 50_000,
	lorebookEntryContent: 50_000,
	lorebookEntryKeys: 5_000,
	// chat content — generous since people paste in long roleplay context
	messageContent: 200_000,
} as const;

export type FieldLimitKey = keyof typeof FIELD_LIMITS;

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
