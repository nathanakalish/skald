import { cacheImage, cacheHtmlImages, cacheInlineImages } from '$lib/services/imageCache.js';
import { db } from '$lib/db/index.js';
import { characters } from '$lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '$lib/server/logger.js';

/**
 * Helpers that cache remote images referenced by character rows.
 *
 * Three pathways:
 *   1. `cacheCharacterTextImages` — synchronously cache images embedded in
 *      `firstMessage`, `alternateGreetings`, and `creatorNotes` as part of an
 *      insert/update payload. Pure transform, no DB I/O.
 *   2. `cacheBackgroundFromExtensions` — pull the chub `background_image` URL
 *      out of the extensions blob and cache it.
 *   3. `ensureCharacterImagesCached` — lazy-cache pass for an existing row,
 *      writing any newly-cached paths back to the DB. Used on read.
 */

export interface CacheableTextFields {
	firstMessage?: string | null;
	alternateGreetings?: string | string[] | null;
	creatorNotes?: string | null;
}

export interface CachedTextFields {
	firstMessage: string | null | undefined;
	/** Always returned JSON-stringified (or the original raw string if parsing failed). */
	alternateGreetings: string;
	creatorNotes: string | null | undefined;
}

/** Cache inline/HTML images in the writable text fields of a character payload. */
export async function cacheCharacterTextImages(input: CacheableTextFields): Promise<CachedTextFields> {
	const firstMessage = input.firstMessage ? await cacheInlineImages(input.firstMessage) : input.firstMessage;
	const creatorNotes = input.creatorNotes ? await cacheHtmlImages(input.creatorNotes) : input.creatorNotes;

	let parsed: string[] | null = null;
	let parseFailed = false;
	if (Array.isArray(input.alternateGreetings)) {
		parsed = input.alternateGreetings as string[];
	} else if (typeof input.alternateGreetings === 'string' && input.alternateGreetings) {
		try {
			const tmp = JSON.parse(input.alternateGreetings);
			parsed = Array.isArray(tmp) ? tmp : [];
		} catch {
			parseFailed = true;
		}
	} else {
		parsed = [];
	}

	let alternateGreetings: string;
	if (parseFailed) {
		// Caller handed us an unparseable string. Preserve it instead of nuking it.
		alternateGreetings = String(input.alternateGreetings ?? '[]');
	} else {
		const cached = await Promise.all(
			(parsed ?? []).map((g) => (g ? cacheInlineImages(g) : Promise.resolve(g)))
		);
		alternateGreetings = JSON.stringify(cached);
	}

	return { firstMessage, alternateGreetings, creatorNotes };
}

/**
 * Pull the chub background_image URL out of a character's `extensions` blob
 * (which is either a string or an object) and download it into the cache.
 * Returns the cached path, or `null` if there's no background or it couldn't
 * be cached.
 */
export async function cacheBackgroundFromExtensions(
	extensions: string | Record<string, unknown> | null | undefined
): Promise<string | null> {
	if (!extensions) return null;
	let parsed: any;
	try {
		parsed = typeof extensions === 'string' ? JSON.parse(extensions || '{}') : extensions;
	} catch {
		return null;
	}
	const bgUrl = parsed?.chub?.background_image;
	if (!bgUrl || typeof bgUrl !== 'string' || !bgUrl.startsWith('http')) return null;
	try {
		const cached = await cacheImage(bgUrl);
		return cached !== bgUrl ? cached : null;
	} catch (err) {
		logger.warn('[characterImageCache] background cache failed', { err: String(err) });
		return null;
	}
}

type CharacterRow = typeof characters.$inferSelect;

/**
 * Lazily cache externally-hosted images for an existing character row, writing
 * any newly-resolved paths back to the DB. Mutates the passed row to reflect
 * the updates. Safe to call on every GET — only does the work it actually needs to.
 */
export async function ensureCharacterImagesCached(character: CharacterRow): Promise<CharacterRow> {
	// 1. Background from extensions (only if not already set).
	if (!character.backgroundPath) {
		const cached = await cacheBackgroundFromExtensions(character.extensions);
		if (cached) {
			db.update(characters).set({ backgroundPath: cached }).where(eq(characters.id, character.id)).run();
			character.backgroundPath = cached;
		}
	}

	// 2. Creator notes HTML images.
	if (character.creatorNotes && /src\s*=\s*["']https?:\/\//i.test(character.creatorNotes)) {
		try {
			const cached = await cacheHtmlImages(character.creatorNotes);
			if (cached !== character.creatorNotes) {
				db.update(characters).set({ creatorNotes: cached }).where(eq(characters.id, character.id)).run();
				character.creatorNotes = cached;
			}
		} catch (err) {
			logger.warn('[characterImageCache] creatorNotes cache failed', { err: String(err) });
		}
	}

	// 3. Inline images in firstMessage + alternateGreetings.
	const hasRemoteImg = (s: string | null | undefined) => !!s && /!\[[^\]]*\]\(https?:\/\//.test(s);
	let altsArr: string[] = [];
	try {
		altsArr = JSON.parse(character.alternateGreetings || '[]');
	} catch {
		altsArr = [];
	}
	if (hasRemoteImg(character.firstMessage) || altsArr.some(hasRemoteImg)) {
		try {
			const cachedFirst = character.firstMessage
				? await cacheInlineImages(character.firstMessage)
				: character.firstMessage;
			const cachedAlts = await Promise.all(
				altsArr.map((g) => (g ? cacheInlineImages(g) : Promise.resolve(g)))
			);
			const firstChanged = cachedFirst !== character.firstMessage;
			const altsChanged = cachedAlts.some((g, i) => g !== altsArr[i]);
			if (firstChanged || altsChanged) {
				db.update(characters)
					.set({
						...(firstChanged ? { firstMessage: cachedFirst } : {}),
						...(altsChanged ? { alternateGreetings: JSON.stringify(cachedAlts) } : {})
					})
					.where(eq(characters.id, character.id))
					.run();
				if (firstChanged) character.firstMessage = cachedFirst;
				if (altsChanged) character.alternateGreetings = JSON.stringify(cachedAlts);
			}
		} catch (err) {
			logger.warn('[characterImageCache] greeting cache failed', { err: String(err) });
		}
	}

	return character;
}
