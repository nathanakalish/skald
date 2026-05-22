import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { storeAvatarFromBuffer, tryDeleteUnreferencedAvatar } from '$lib/services/imageOptimizer.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { logger } from '$lib/server/logger.js';
import { ApiError } from '$lib/server/apiError.js';

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return ApiError.badRequest('Invalid persona id');

	const existing = db
		.select()
		.from(personas)
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.get();
	if (!existing) return ApiError.notFound('Persona not found');

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return ApiError.badRequest('No file provided');

	const maxBytes = (getAdminSettingNumber('avatarUploadMaxMiB') || 8) * 1024 * 1024;
	if (file.size > maxBytes) {
		return json(
			{ error: `File too large — max ${Math.round(maxBytes / 1024 / 1024)} MiB.` },
			{ status: 413 },
		);
	}
	if (!ACCEPTED_MIME.includes(file.type)) {
		return ApiError.badRequest('Unsupported image type. Use PNG, JPEG, WebP, or GIF.');
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	// Capture the existing avatar BEFORE we update — we may need to clean it
	// up on disk if no other persona/character still uses it.
	const prior = db.select({ avatarPath: personas.avatarPath })
		.from(personas)
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.get();

	let avatarPath: string;
	try {
		avatarPath = await storeAvatarFromBuffer(buffer, file.type);
	} catch (err) {
		logger.warn('persona avatar: optimize/write failed', { err: err instanceof Error ? err.message : String(err) });
		return ApiError.server('Failed to process image');
	}

	db.update(personas)
		.set({ avatarPath })
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.run();

	if (prior?.avatarPath && prior.avatarPath !== avatarPath) {
		tryDeleteUnreferencedAvatar(prior.avatarPath);
	}

	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, avatarPath, personas: list });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return ApiError.badRequest('Invalid persona id');

	const prior = db.select({ avatarPath: personas.avatarPath })
		.from(personas)
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.get();

	db.update(personas)
		.set({ avatarPath: null })
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.run();

	if (prior?.avatarPath) tryDeleteUnreferencedAvatar(prior.avatarPath);

	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, personas: list });
};
