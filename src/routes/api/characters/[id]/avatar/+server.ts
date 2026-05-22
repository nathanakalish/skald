import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { characters } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { storeAvatarFromBuffer, tryDeleteUnreferencedAvatar } from '$lib/services/imageOptimizer.js';
import { extractThemeFromAvatar } from '$lib/services/themeExtractor.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { logger } from '$lib/server/logger.js';
import { ApiError } from '$lib/server/apiError.js';

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return ApiError.badRequest('Invalid character id');

	const existing = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	if (!existing) return ApiError.notFound('Character not found');

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return ApiError.badRequest('No file provided');

	const maxBytes = (getAdminSettingNumber('avatarUploadMaxMiB') || 8) * 1024 * 1024;
	if (file.size > maxBytes) {
		return ApiError.payloadTooLarge(`File too large — max ${Math.round(maxBytes / 1024 / 1024)} MiB.`);
	}
	if (!ACCEPTED_MIME.includes(file.type)) {
		return ApiError.badRequest('Unsupported image type. Use PNG, JPEG, WebP, or GIF.');
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	let avatarPath: string;
	try {
		avatarPath = await storeAvatarFromBuffer(buffer, file.type);
	} catch (err) {
		logger.warn('character avatar: optimize/write failed', {
			err: err instanceof Error ? err.message : String(err)
		});
		return ApiError.server('Failed to process image');
	}

	// Re-extract theme palette unless the user has manually customized colors.
	let nextTheme: string | undefined;
	if (!existing.themeUserModified) {
		try {
			const extracted = await extractThemeFromAvatar(buffer);
			if (extracted) nextTheme = JSON.stringify(extracted);
		} catch (err) {
			logger.warn('character avatar: theme extraction failed', {
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}

	db.update(characters)
		.set({
			avatarPath,
			updatedAt: new Date().toISOString(),
			...(nextTheme ? { theme: nextTheme } : {})
		})
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.run();

	// Best-effort: clean up the previous avatar files now that the row is updated.
	// Skipped automatically if another character/persona still points at the same path.
	if (existing.avatarPath && existing.avatarPath !== avatarPath) {
		tryDeleteUnreferencedAvatar(existing.avatarPath);
	}

	const updated = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	const light = updated
		? {
			id: updated.id,
			name: updated.name,
			avatarPath: updated.avatarPath,
			description: updated.description,
			tags: updated.tags,
			creator: updated.creator,
			characterVersion: updated.characterVersion,
			theme: updated.theme,
			backgroundPath: updated.backgroundPath,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt
		}
		: null;
	if (light) broadcast(user.id, { type: 'character:updated', id, character: light as any });
	return json({ ok: true, avatarPath, themeReextracted: !!nextTheme, character: updated });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return ApiError.badRequest('Invalid character id');

	const existing = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	if (!existing) return ApiError.notFound('Character not found');

	db.update(characters)
		.set({ avatarPath: null, updatedAt: new Date().toISOString() })
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.run();

	// Cleanup AFTER the row's avatarPath is nulled, so the refcount on this
	// row is zero. Skipped automatically if anyone else still uses the file.
	tryDeleteUnreferencedAvatar(existing.avatarPath);

	const updated = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	const light = updated
		? {
			id: updated.id,
			name: updated.name,
			avatarPath: updated.avatarPath,
			description: updated.description,
			tags: updated.tags,
			creator: updated.creator,
			characterVersion: updated.characterVersion,
			theme: updated.theme,
			backgroundPath: updated.backgroundPath,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt
		}
		: null;
	if (light) broadcast(user.id, { type: 'character:updated', id, character: light as any });
	return json({ ok: true, character: updated });
};
