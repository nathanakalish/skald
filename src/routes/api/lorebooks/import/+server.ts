import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { parseCharacterBook } from '$lib/services/character.js';
import { requireUser } from '$lib/server/auth.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { enforceCreate } from '$lib/server/userLimits.js';
import { checkLength } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';

const MAX_LOREBOOK_ENTRIES = 5_000;

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const startedAt = Date.now();

	const limitResponse = enforceCreate('lorebooks', user.id);
	if (limitResponse) return limitResponse;

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;

	if (!file) {
		return ApiError.badRequest('No file provided');
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
		return ApiError.badRequest('Invalid JSON file');
	}

	if (!data || typeof data !== 'object') {
		return ApiError.badRequest('Invalid lorebook format');
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
		return ApiError.badRequest('Could not find lorebook entries in file');
	}

	const parsed = parseCharacterBook(bookRaw);
	if (!parsed || parsed.entries.length === 0) {
		return ApiError.badRequest('No valid entries found in lorebook');
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

	// Enforce field-length caps before we touch the DB. The whole import is
	// rejected if anything is over — partial imports here would be worse than
	// making the user trim the offending entry and re-upload.
	const nameViolation = checkLength(bookName, 'name', 'name');
	if (nameViolation) {
		return json({
			error: `Lorebook name exceeds maximum length of ${nameViolation.limit} characters (got ${nameViolation.length}).`,
		}, { status: 400 });
	}
	for (let i = 0; i < parsed.entries.length; i++) {
		const entry = parsed.entries[i];
		const keywords = entry.keys.join(', ');
		const kv = checkLength(keywords, 'lorebookEntryKeys', `entries[${i}].keys`);
		if (kv) {
			return json({
				error: `Lorebook entry #${i + 1} keys exceed maximum length of ${kv.limit} characters (got ${kv.length}).`,
			}, { status: 400 });
		}
		const cv = checkLength(entry.content, 'lorebookEntryContent', `entries[${i}].content`);
		if (cv) {
			return json({
				error: `Lorebook entry #${i + 1} content exceeds maximum length of ${cv.limit} characters (got ${cv.length}).`,
			}, { status: 400 });
		}
	}

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
