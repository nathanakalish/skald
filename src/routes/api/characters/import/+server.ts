import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters, lorebooks, lorebookEntries } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { parseCharaCardFromPNG, parseCharaJSON } from '$lib/services/character.js';
import {
	cacheCharacterTextImages,
	cacheBackgroundFromExtensions
} from '$lib/services/characterImageCache.js';
import {
	storeAvatarFromBuffer, isPlaceholderAvatar
} from '$lib/services/imageOptimizer.js';
import { extractThemeFromAvatar } from '$lib/services/themeExtractor.js';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { getAdminSettingBool, getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { enforceCreate } from '$lib/server/userLimits.js';
import { logger } from '$lib/server/logger.js';
import { lorebookEntryFingerprint } from '$lib/services/lorebook.js';
import { findLengthViolation, checkLength, type LengthViolation } from '$lib/server/fieldLimits.js';
import { ApiError } from '$lib/server/apiError.js';
/** PNG character cards: configurable cap (default 8 MiB). JSON cards: 2 MiB cap. */
const MAX_JSON_BYTES = 2 * 1024 * 1024;

/** PNG file magic: 89 50 4E 47 0D 0A 1A 0A */
function isPng(buf: Buffer): boolean {
	return buf.length >= 8 &&
		buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
		buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

const CHARACTER_CARD_FIELD_LIMITS = {
	name: 'name',
	description: 'description',
	personality: 'personality',
	scenario: 'scenario',
	firstMessage: 'firstMessage',
	mesExample: 'mesExample',
	systemPrompt: 'systemPrompt',
	postHistoryInstructions: 'postHistoryInstructions',
	creatorNotes: 'creatorNotes',
	creator: 'name',
	characterVersion: 'name',
} as const;

function violationResponse(v: LengthViolation, prefix = '') {
	const label = prefix ? `${prefix} field "${v.field}"` : `Field "${v.field}"`;
	return json(
		{ error: `${label} exceeds maximum length of ${v.limit} characters (got ${v.length}). Edit the card and try again.` },
		{ status: 400 },
	);
}

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const startedAt = Date.now();

	if (!getAdminSettingBool('allowCharacterImport') && user.role !== 'admin') {
		return ApiError.forbidden('Character import is disabled by the administrator');
	}

	const limitResponse = enforceCreate('characters', user.id);
	if (limitResponse) return limitResponse;

	const request = event.request;
	const contentType = request.headers.get('content-type') || '';

	let cardData;
	let avatarBuffer: Buffer | null = null;

	if (contentType.includes('multipart/form-data')) {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;

		if (!file) {
			return ApiError.badRequest('No file uploaded');
		}

		const fileName = file.name.toLowerCase();

		// Per-type size cap, before we read into memory.
		const maxPngMiB = getAdminSettingNumber('characterImportMaxMiB') || 8;
		const sizeCap = fileName.endsWith('.png') ? maxPngMiB * 1024 * 1024 : MAX_JSON_BYTES;
		if (file.size > sizeCap) {
			return json({
				error: `File too large — max ${Math.round(sizeCap / 1024 / 1024)} MiB for this type.`,
			}, { status: 413 });
		}

		const arrayBuf = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuf);

		if (fileName.endsWith('.png')) {
			if (!isPng(buffer)) {
				logger.warn('character import: PNG magic byte mismatch', { userId: user.id, fileName });
				return ApiError.badRequest('File is not a valid PNG image.');
			}
			cardData = parseCharaCardFromPNG(buffer);
			avatarBuffer = buffer;
		} else if (fileName.endsWith('.json')) {
			const text = buffer.toString('utf-8');
			try {
				cardData = parseCharaJSON(JSON.parse(text));
			} catch {
				return ApiError.badRequest('Invalid JSON file.');
			}
		} else {
			return ApiError.badRequest('Unsupported file type. Use .png or .json');
		}
	} else if (contentType.includes('application/json')) {
		// Cap raw JSON bodies (M10) — request.json() will happily parse a 1 GiB
		// payload otherwise.
		const text = await request.text();
		if (text.length > MAX_JSON_BYTES) {
			return ApiError.payloadTooLarge(`JSON body too large — max ${Math.round(MAX_JSON_BYTES / 1024 / 1024)} MiB.`);
		}
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return ApiError.badRequest('Invalid JSON body.');
		}
		cardData = parseCharaJSON(body as Record<string, unknown>);
	} else {
		return ApiError.badRequest('Unsupported content type');
	}

	// Enforce character-field length limits. Soft toggle via admin setting —
	// `findLengthViolation` is a no-op when limits are disabled.
	const cardViolation = findLengthViolation(
		cardData as unknown as Record<string, unknown>,
		CHARACTER_CARD_FIELD_LIMITS,
	);
	if (cardViolation) {
		logger.info('character import: rejected (field too long)', {
			userId: user.id, field: cardViolation.field, limit: cardViolation.limit, length: cardViolation.length,
		});
		return violationResponse(cardViolation, 'Character');
	}
	// `tags` and `alternateGreetings` are arrays on the parsed shape but get
	// stored as JSON strings, so check the serialized length against the same
	// caps the per-field validator uses elsewhere.
	const tagsJson = JSON.stringify(cardData.tags ?? []);
	const tagsViolation = checkLength(tagsJson, 'tags', 'tags');
	if (tagsViolation) return violationResponse(tagsViolation, 'Character');
	for (let i = 0; i < (cardData.alternateGreetings ?? []).length; i++) {
		const v = checkLength(cardData.alternateGreetings[i], 'firstMessage', `alternateGreetings[${i}]`);
		if (v) return violationResponse(v, 'Character');
	}
	// Embedded character_book entries — same rules as a standalone lorebook.
	if (cardData.characterBook) {
		for (let i = 0; i < cardData.characterBook.entries.length; i++) {
			const entry = cardData.characterBook.entries[i];
			const keywords = entry.keys.join(', ');
			const kv = checkLength(keywords, 'lorebookEntryKeys', `characterBook.entries[${i}].keys`);
			if (kv) return violationResponse(kv, 'Character');
			const cv = checkLength(entry.content, 'lorebookEntryContent', `characterBook.entries[${i}].content`);
			if (cv) return violationResponse(cv, 'Character');
		}
	}

	// Save the avatar if we have one. Skip 1x1 placeholder PNGs (exported from
	// characters that had no avatar) and corrupt image data — both fall back to
	// the initial-letter placeholder in the UI.
	let avatarPath: string | null = null;
	if (avatarBuffer && !(await isPlaceholderAvatar(avatarBuffer))) {
		try {
			// Imports come from chara card PNGs — always PNG. Storing under the
			// content hash means re-importing the same card is a no-op on disk.
			avatarPath = await storeAvatarFromBuffer(avatarBuffer, 'image/png');
		} catch (avatarErr) {
			logger.warn('character import: avatar processing failed, importing without avatar', { userId: user.id, err: String(avatarErr) });
		}
	}

	// Background image from extensions, if present.
	const backgroundPath = await cacheBackgroundFromExtensions(cardData.extensions as any);

	// Pull theme colors out of the avatar (only if a real avatar was saved).
	let theme: string | undefined;
	if (avatarBuffer && avatarPath) {
		const extracted = await extractThemeFromAvatar(avatarBuffer);
		if (extracted) theme = JSON.stringify(extracted);
	}

	// Cache inline images from greetings and creator notes.
	const cachedText = await cacheCharacterTextImages({
		firstMessage: cardData.firstMessage,
		alternateGreetings: cardData.alternateGreetings ?? [],
		creatorNotes: cardData.creatorNotes
	});

	const result = db.transaction((tx) => {
		const character = tx
			.insert(characters)
			.values({
				userId: user.id,
				name: cardData.name,
				description: cardData.description,
				personality: cardData.personality,
				firstMessage: cachedText.firstMessage ?? '',
				scenario: cardData.scenario,
				systemPrompt: cardData.systemPrompt,
				avatarPath,
				backgroundPath,
				theme,
				creatorNotes: cachedText.creatorNotes ?? '',
				tags: JSON.stringify(cardData.tags),
				mesExample: cardData.mesExample,
				postHistoryInstructions: cardData.postHistoryInstructions,
				alternateGreetings: cachedText.alternateGreetings,
				creator: cardData.creator,
				characterVersion: cardData.characterVersion,
				extensions: JSON.stringify(cardData.extensions)
			})
			.returning()
			.get();

		// Import embedded lorebook if present (character_book)
		let importedLorebook: typeof lorebooks.$inferSelect | null = null;
		let importedLorebookIsNew = false;
		if (cardData.characterBook) {
			const lorebookName = cardData.characterBook.name === 'Character Lorebook'
				? `${character.name} Lorebook`
				: cardData.characterBook.name;

			// Check for existing lorebook with same name for this user
			const existing = tx.select().from(lorebooks)
				.where(and(eq(lorebooks.userId, user.id), eq(lorebooks.name, lorebookName)))
				.get();

			const book = existing ?? tx
				.insert(lorebooks)
				.values({
					userId: user.id,
					name: lorebookName,
					description: `Imported with ${character.name}`,
					characterId: character.id,
					enabled: true,
				})
				.returning()
				.get();
			importedLorebook = book;
			importedLorebookIsNew = !existing;

			// Link the character to the lorebook if it wasn't already
			if (existing && !existing.characterId) {
				tx.update(lorebooks)
					.set({ characterId: character.id })
					.where(eq(lorebooks.id, existing.id))
					.run();
			}

			// Only add entries whose (keywords, content) fingerprint isn't
			// already present. Compares content too — see IMPORT-H3.
			const existingFingerprints = existing
				? new Set(tx.select().from(lorebookEntries).where(eq(lorebookEntries.lorebookId, book.id)).all().map(e => lorebookEntryFingerprint(e.keywords, e.content)))
				: new Set<string>();

			for (const entry of cardData.characterBook.entries) {
				const keywords = entry.keys.join(', ');
				const fp = lorebookEntryFingerprint(keywords, entry.content);
				if (existingFingerprints.has(fp)) continue;
				existingFingerprints.add(fp);
				tx.insert(lorebookEntries)
					.values({
						lorebookId: book.id,
						keywords,
						content: entry.content,
						insertionOrder: entry.insertionOrder,
						enabled: entry.enabled,
						caseSensitive: entry.caseSensitive,
						constant: entry.constant,
					})
					.run();
			}
		}

		return { character, importedLorebook, importedLorebookIsNew };
	});

	const character = result?.character ?? null;
	const light = character ? {
		id: character.id,
		name: character.name,
		avatarPath: character.avatarPath,
		description: character.description,
		tags: character.tags,
		creator: character.creator,
		characterVersion: character.characterVersion,
		theme: character.theme,
		backgroundPath: character.backgroundPath,
		createdAt: character.createdAt,
		updatedAt: character.updatedAt
	} : null;

	// Notify the user's other tabs / sessions that the lorebook list changed
	// so the lorebook library updates without needing a reload.
	if (result?.importedLorebook) {
		if (result.importedLorebookIsNew) {
			broadcast(user.id, {
				type: 'lorebook:created',
				lorebook: result.importedLorebook as any,
			});
		} else {
			broadcast(user.id, {
				type: 'lorebook:updated',
				id: result.importedLorebook.id,
				lorebook: result.importedLorebook as any,
			});
		}
	}

	event.locals.logger.info('import: character complete', {
		userId: user.id,
		characterId: character?.id,
		durationMs: Date.now() - startedAt,
		hasLorebook: !!result?.importedLorebook,
		lorebookIsNew: result?.importedLorebookIsNew ?? false,
	});

	return json({ ...(character ?? {}), light });
};
