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

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return json({ error: 'Invalid character id' }, { status: 400 });

	const existing = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	if (!existing) return json({ error: 'Character not found' }, { status: 404 });

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return json({ error: 'No file provided' }, { status: 400 });

	const maxBytes = (getAdminSettingNumber('avatarUploadMaxMiB') || 8) * 1024 * 1024;
	if (file.size > maxBytes) {
		return json(
			{ error: `File too large — max ${Math.round(maxBytes / 1024 / 1024)} MiB.` },
			{ status: 413 }
		);
	}
	if (!ACCEPTED_MIME.includes(file.type)) {
		return json({ error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	let avatarPath: string;
	try {
		avatarPath = await storeAvatarFromBuffer(buffer, file.type);
	} catch (err) {
		logger.warn('character avatar: optimize/write failed', {
			err: err instanceof Error ? err.message : String(err)
		});
		return json({ error: 'Failed to process image' }, { status: 500 });
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
	if (!Number.isFinite(id)) return json({ error: 'Invalid character id' }, { status: 400 });

	const existing = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, id), eq(characters.userId, user.id)))
		.get();
	if (!existing) return json({ error: 'Character not found' }, { status: 404 });

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
