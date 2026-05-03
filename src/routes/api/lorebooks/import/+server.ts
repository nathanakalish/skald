import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { parseCharacterBook } from '$lib/services/character.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { enforceCreate } from '$lib/server/userLimits.js';

const MAX_LOREBOOK_ENTRIES = 5_000;

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const startedAt = Date.now();

	const limitResponse = enforceCreate('lorebooks', user.id);
	if (limitResponse) return limitResponse;

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;

	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}
	const maxBytes = (getAdminSettingNumber('lorebookImportMaxMiB') || 4) * 1024 * 1024;
	if (file.size > maxBytes) {
		return json({
			error: `File too large — max ${Math.round(maxBytes / 1024 / 1024)} MiB.`,
		}, { status: 413 });
	}

	const text = await file.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON file' }, { status: 400 });
	}

	if (!data || typeof data !== 'object') {
		return json({ error: 'Invalid lorebook format' }, { status: 400 });
	}

	const obj = data as Record<string, unknown>;

	// Support multiple formats:
	// 1. Direct character_book / lorebook object with entries array
	// 2. Wrapped: { data: { ... } } (SillyTavern export format)
	// 3. Wrapped: { character_book: { ... } }
	let bookRaw: unknown = null;

	if (Array.isArray(obj.entries)) {
		// Direct lorebook object
		bookRaw = obj;
	} else if (obj.data && typeof obj.data === 'object' && Array.isArray((obj.data as Record<string, unknown>).entries)) {
		bookRaw = obj.data;
	} else if (obj.character_book && typeof obj.character_book === 'object') {
		bookRaw = obj.character_book;
	}

	if (!bookRaw) {
		return json({ error: 'Could not find lorebook entries in file' }, { status: 400 });
	}

	const parsed = parseCharacterBook(bookRaw);
	if (!parsed || parsed.entries.length === 0) {
		return json({ error: 'No valid entries found in lorebook' }, { status: 400 });
	}
	if (parsed.entries.length > MAX_LOREBOOK_ENTRIES) {
		return json({
			error: `Lorebook has too many entries (${parsed.entries.length}); max ${MAX_LOREBOOK_ENTRIES}.`,
		}, { status: 413 });
	}

	// Derive name from JSON or filename
	const bookName = parsed.name !== 'Character Lorebook'
		? parsed.name
		: file.name.replace(/\.json$/i, '') || 'Imported Lorebook';

	const result = db.transaction((tx) => {
		const book = tx
			.insert(lorebooks)
			.values({
				userId: user.id,
				name: bookName,
				description: `Imported from ${file.name}`,
				enabled: true,
			})
			.returning()
			.get();

		for (const entry of parsed.entries) {
			tx.insert(lorebookEntries)
				.values({
					lorebookId: book.id,
					keywords: entry.keys.join(', '),
					content: entry.content,
					insertionOrder: entry.insertionOrder,
					enabled: entry.enabled,
					caseSensitive: entry.caseSensitive,
					constant: entry.constant,
				})
				.run();
		}

		return book;
	});

	event.locals.logger.info('import: lorebook complete', {
		userId: user.id,
		lorebookId: result.id,
		entryCount: parsed.entries.length,
		durationMs: Date.now() - startedAt,
	});

	return json({ id: result.id, name: result.name, entryCount: parsed.entries.length, lorebook: result });
};
