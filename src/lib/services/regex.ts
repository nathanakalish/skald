import { db } from '$lib/db/index.js';
import { regexScripts } from '$lib/db/schema.js';
import { eq, and, asc, isNull, or } from 'drizzle-orm';

export type RegexScope = 'user_input' | 'ai_response';

/**
 * Catch the common catastrophic-backtracking patterns (nested quantifiers).
 * Rejects (a+)+, (a*)+, (a+)*, (a|b+)+ and friends.
 */
function isSafeRegex(pattern: string): boolean {
	// Nested quantifiers — a quantifier (+, *, {n,}) on a group that already
	// contains a quantifier. The classic catastrophic-backtracking shape.
	if (/\([^)]*[+*}][^)]*\)[+*]|\([^)]*[+*][^)]*\)\{/.test(pattern)) {
		return false;
	}
	// Long patterns are risky too. 500 chars is plenty for anyone.
	if (pattern.length > 500) {
		return false;
	}
	return true;
}

/**
 * Parse a regex string like "/pattern/flags" into a RegExp.
 * Plain strings (no slashes) are treated as literal matches.
 */
function parseRegex(findRegex: string): RegExp | null {
	const match = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
	if (match) {
		if (!isSafeRegex(match[1])) return null;
		try {
			return new RegExp(match[1], match[2]);
		} catch {
			return null;
		}
	}
	// Treat as literal string — escape regex metacharacters.
	const escaped = findRegex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(escaped, 'g');
}

/**
 * Load and apply every matching regex script for a user/character/scope combo.
 */
export function applyRegexScripts(
	text: string,
	userId: number,
	scope: RegexScope,
	characterId?: number | null
): string {
	const scopeField = scope === 'user_input' ? regexScripts.affectUserInput : regexScripts.affectAiResponse;

	// Load scripts: global (characterId IS NULL) + character-specific, ordered by sortOrder.
	const scripts = db.select()
		.from(regexScripts)
		.where(
			and(
				eq(regexScripts.userId, userId),
				eq(scopeField, true),
				eq(regexScripts.enabled, true),
				characterId
					? or(isNull(regexScripts.characterId), eq(regexScripts.characterId, characterId))
					: isNull(regexScripts.characterId)
			)
		)
		.orderBy(asc(regexScripts.sortOrder))
		.all();

	let result = text;
	for (const script of scripts) {
		const regex = parseRegex(script.findRegex);
		if (!regex) continue;
		result = result.replace(regex, script.replaceString);
	}
	return result;
}
