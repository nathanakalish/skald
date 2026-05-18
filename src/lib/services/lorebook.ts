import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries, chatLorebooks, chatLorebookEntryOverrides } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';
import { createHash } from 'node:crypto';

/**
 * Dedup fingerprint for a lorebook entry. Includes a content hash so two
 * entries that share the same keyword set but disagree on the actual lore
 * content are treated as distinct — see IMPORT-H3.
 */
export function lorebookEntryFingerprint(keywords: string, content: string): string {
	const c = createHash('sha256').update(content ?? '').digest('hex').slice(0, 16);
	return `${keywords}|||${c}`;
}

export interface MatchedLorebookEntry {
	content: string;
	insertionOrder: number;
}

// Compiled-regex LRU keyed by `${caseSensitive?'s':'i'}|${keyword}`.
//
// PERF-H2: every send was rebuilding every entry's RegExp (escape + new
// RegExp). For a book of 50 entries with 5 keywords each that's 250
// allocations per send; the pattern source rarely changes between sends.
// Cap is generous: a few thousand entries' worth of keywords.
const REGEX_CACHE_MAX = 2000;
const _regexCache = new Map<string, RegExp>();

function getKeywordRegex(keyword: string, caseSensitive: boolean): RegExp {
	const cacheKey = (caseSensitive ? 's|' : 'i|') + keyword;
	const hit = _regexCache.get(cacheKey);
	if (hit) {
		// Touch for LRU ordering.
		_regexCache.delete(cacheKey);
		_regexCache.set(cacheKey, hit);
		return hit;
	}
	const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// No `g` flag — we only ever call `.test()`, where `g` does nothing useful
	// and forces `lastIndex` bookkeeping that would surprise the next caller.
	const re = new RegExp(`\\b${escaped}\\b`, caseSensitive ? '' : 'i');
	_regexCache.set(cacheKey, re);
	if (_regexCache.size > REGEX_CACHE_MAX) {
		const oldest = _regexCache.keys().next().value;
		if (oldest !== undefined) _regexCache.delete(oldest);
	}
	return re;
}

/**
 * Find every lorebook entry that should get injected into the prompt.
 *
 * Only lorebooks that belong to the character OR have been explicitly added to
 * the chat by the user are considered. Global lorebooks never auto-include.
 *
 * Entries match if:
 * 1. They belong to an enabled lorebook linked to the character, OR an enabled lorebook added to this chat
 * 2. The entry is enabled
 * 3. The entry is `constant` (always inject), OR any of its keywords appear in user messages
 *
 * Keyword checks are whole-word matches against user messages only — assistant
 * messages are excluded so the model can't trigger its own lore (feedback loops).
 */
export function matchLorebookEntries(
	characterId: number,
	chatId: number,
	chatMessages: { content: string; role: string }[],
): MatchedLorebookEntry[] {
	// Match keywords against user messages only — model's own output is off-limits.
	const searchText = chatMessages.filter(m => m.role === 'user').map(m => m.content).join('\n');

	// Character-specific lorebooks.
	const characterBooks = db
		.select()
		.from(lorebooks)
		.where(and(eq(lorebooks.enabled, true), eq(lorebooks.characterId, characterId)))
		.all();

	// User-added lorebooks for this specific chat.
	const chatBookLinks = db
		.select({ lorebookId: chatLorebooks.lorebookId })
		.from(chatLorebooks)
		.where(eq(chatLorebooks.chatId, chatId))
		.all();

	const chatBookIds = chatBookLinks.map(l => l.lorebookId);
	const additionalBooks = chatBookIds.length > 0
		? db.select().from(lorebooks)
			.where(and(eq(lorebooks.enabled, true), inArray(lorebooks.id, chatBookIds)))
			.all()
		: [];

	// Dedupe: character books take precedence, skip any additionalBooks with the same id.
	const seenIds = new Set(characterBooks.map(b => b.id));
	const relevantBooks = [...characterBooks, ...additionalBooks.filter(b => !seenIds.has(b.id))];
	if (relevantBooks.length === 0) return [];

	const matched: MatchedLorebookEntry[] = [];

	// Batch-fetch all entries for relevant lorebooks in one query. We can't
	// filter by `enabled` in SQL anymore because per-chat overrides can flip
	// the effective enabled state in either direction.
	const bookIds = relevantBooks.map(b => b.id);
	const allEntries = db
		.select()
		.from(lorebookEntries)
		.where(inArray(lorebookEntries.lorebookId, bookIds))
		.all();

	// Per-chat per-entry overrides (NULL = use the library default).
	const overrideRows = db
		.select()
		.from(chatLorebookEntryOverrides)
		.where(eq(chatLorebookEntryOverrides.chatId, chatId))
		.all();
	const overrides = new Map<number, { enabled: boolean | null; constant: boolean | null }>();
	for (const o of overrideRows) {
		overrides.set(o.entryId, { enabled: o.enabled ?? null, constant: o.constant ?? null });
	}

	for (const entry of allEntries) {
		const ov = overrides.get(entry.id);
		const effEnabled = ov?.enabled ?? entry.enabled ?? true;
		if (!effEnabled) continue;
		const effConstant = ov?.constant ?? entry.constant ?? false;

		// Constant entries always go in.
		if (effConstant) {
			matched.push({
				content: entry.content,
				insertionOrder: entry.insertionOrder ?? 100,
			});
			continue;
		}

		// Otherwise check keywords against the chat text.
		const keywords = entry.keywords
			.split(',')
			.map(k => k.trim())
			.filter(Boolean);

		const caseSensitive = !!entry.caseSensitive;
		const isMatch = keywords.some(keyword => {
			const pattern = getKeywordRegex(keyword, caseSensitive);
			return pattern.test(searchText);
		});

		if (isMatch) {
			matched.push({
				content: entry.content,
				insertionOrder: entry.insertionOrder ?? 100,
			});
		}
	}

	logger.debug('lorebook: context built', {
		characterId, chatId,
		bookCount: relevantBooks.length,
		totalEntries: allEntries.length,
		matchedCount: matched.length,
	});
	return matched;
}
