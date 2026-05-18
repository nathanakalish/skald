import { db } from '$lib/db/index.js';
import { regexScripts } from '$lib/db/schema.js';
import { eq, and, asc, isNull, or } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export type RegexScope = 'user_input' | 'ai_response';

/**
 * Structural safety check for user-supplied regex patterns. We can't safely
 * execute a regex in a thread with a hard timeout in Node without spinning
 * up a worker per `.replace()` (too expensive), so the line of defence is
 * purely static — reject anything that looks like classic catastrophic
 * backtracking before it ever gets compiled.
 *
 * What we catch:
 *   - Nested quantifiers:        (a+)+, (a*)*, (a+)*, ((a*)*)
 *   - Alternation under quantifier: (a|b)+, (foo|bar)*, (x|y){1,5}
 *   - Bounded-then-unbounded:    (a{1,10})*, (a{0,5})+
 *   - Excessive pattern length (>500 chars)
 *
 * Net is intentionally a bit wider than necessary — false positives on
 * benign-but-weird patterns are acceptable; ReDoS isn't.
 *
 * Exported for tests; not part of the public service surface.
 */
export function isSafeRegex(pattern: string): boolean {
	if (pattern.length > 500) return false;

	// Walk the pattern with a small stack so we can ask, for each group,
	// "does this group contain alternation, or a nested quantifier?" When we
	// see the closing `)`, look at the next character — if it's an unbounded
	// quantifier (`+`, `*`, `{n,}`) and the group was "interesting", reject.
	type Frame = { hasAlternation: boolean; hasQuantifier: boolean };
	const stack: Frame[] = [];
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		// Skip escaped chars wholesale — they can't open/close groups.
		if (c === '\\') { i++; continue; }
		// Skip character classes (`[...]`) — `|`, `*`, `+` inside are literals.
		if (c === '[') {
			while (i < pattern.length && pattern[i] !== ']') {
				if (pattern[i] === '\\') i++;
				i++;
			}
			continue;
		}
		if (c === '(') {
			stack.push({ hasAlternation: false, hasQuantifier: false });
			continue;
		}
		if (c === '|' && stack.length > 0) {
			stack[stack.length - 1].hasAlternation = true;
			continue;
		}
		if ((c === '+' || c === '*' || c === '{') && stack.length > 0) {
			stack[stack.length - 1].hasQuantifier = true;
			// Don't `continue` — we want this same char to be evaluated as a
			// quantifier on the previous token below (closing-paren case).
		}
		if (c === ')') {
			const frame = stack.pop();
			if (!frame) continue;
			const next = pattern[i + 1];
			// Unbounded repetition on a group that already loops or branches
			// = the classic explosion shape. `{n,}` with no upper bound and
			// `{n,m}` are both treated the same way for safety; `?` is fine
			// (at most one repetition, no backtracking explosion).
			const looksRepeated = next === '+' || next === '*' || next === '{';
			if (looksRepeated && (frame.hasAlternation || frame.hasQuantifier)) {
				return false;
			}
		}
	}

	return true;
}

// Hard ceiling on input size we'll feed a user regex. Past this point even
// well-formed patterns start to take measurable time, and the application
// has bigger problems if a single message field is this large.
const MAX_REGEX_INPUT_LEN = 200_000;

/**
 * Parse a regex string like "/pattern/flags" into a RegExp.
 * Plain strings (no slashes) are treated as literal matches.
 */
function parseRegex(findRegex: string): RegExp | null {
	const match = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
	if (match) {
		if (!isSafeRegex(match[1])) {
			logger.warn('regex: rejected as unsafe', { pattern: match[1].slice(0, 200) });
			return null;
		}
		try {
			return new RegExp(match[1], match[2]);
		} catch (err) {
			logger.warn('regex: parse failed', { pattern: match[1].slice(0, 200), err: String(err) });
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
	let appliedCount = 0;
	for (const script of scripts) {
		const regex = parseRegex(script.findRegex);
		if (!regex) continue;
		if (result.length > MAX_REGEX_INPUT_LEN) {
			// Bail rather than feed an unbounded blob into a user regex.
			logger.warn('regex: skipped script — input too large', {
				userId, scope, scriptId: script.id, inputLen: result.length, max: MAX_REGEX_INPUT_LEN,
			});
			continue;
		}
		const before = result;
		result = result.replace(regex, script.replaceString);
		if (result !== before) appliedCount++;
	}
	if (scripts.length > 0) {
		logger.trace('regex: scripts applied', {
			userId, scope, characterId: characterId ?? null,
			scriptCount: scripts.length, appliedCount,
		});
	}
	return result;
}
