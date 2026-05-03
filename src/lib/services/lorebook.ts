import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries, chatLorebooks, chatLorebookEntryOverrides } from '$lib/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

export interface MatchedLorebookEntry {
	content: string;
	insertionOrder: number;
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

		const flags = entry.caseSensitive ? 'g' : 'gi';
		const isMatch = keywords.some(keyword => {
			// Escape regex specials, match as a whole word.
			const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const pattern = new RegExp(`\\b${escaped}\\b`, flags);
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
