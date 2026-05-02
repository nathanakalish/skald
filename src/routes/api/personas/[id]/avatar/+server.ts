import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';
import { optimizeAvatar, getAvatarOriginalsDir } from '$lib/services/imageOptimizer.js';
import { getAdminSettingNumber } from '$lib/server/adminSettings.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '$lib/server/logger.js';

const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return json({ error: 'Invalid persona id' }, { status: 400 });

	const existing = db
		.select()
		.from(personas)
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.get();
	if (!existing) return json({ error: 'Persona not found' }, { status: 404 });

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return json({ error: 'No file provided' }, { status: 400 });

	const maxBytes = (getAdminSettingNumber('avatarUploadMaxMiB') || 8) * 1024 * 1024;
	if (file.size > maxBytes) {
		return json(
			{ error: `File too large — max ${Math.round(maxBytes / 1024 / 1024)} MiB.` },
			{ status: 413 },
		);
	}
	if (!ACCEPTED_MIME.includes(file.type)) {
		return json({ error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const uuid = randomUUID();

	try {
		const avatarDir = join(process.cwd(), 'static', 'avatars');
		mkdirSync(avatarDir, { recursive: true });
		// Save original (best-effort) for full-resolution access later.
		// Use the real image extension derived from the upload's content-type
		// (M16) — we used to write everything as `.bin`, which made these
		// files un-servable and effectively a disk leak.
		const EXT_BY_MIME: Record<string, string> = {
			'image/png': '.png',
			'image/jpeg': '.jpg',
			'image/webp': '.webp',
			'image/gif': '.gif'
		};
		const origExt = EXT_BY_MIME[file.type] ?? '.bin';
		try {
			writeFileSync(join(getAvatarOriginalsDir(), `${uuid}${origExt}`), buffer);
		} catch (err) {
			logger.warn('persona avatar: original save failed', { err: err instanceof Error ? err.message : String(err) });
		}
		const optimized = await optimizeAvatar(buffer);
		writeFileSync(join(avatarDir, `${uuid}.webp`), optimized);
	} catch (err) {
		logger.warn('persona avatar: optimize/write failed', { err: err instanceof Error ? err.message : String(err) });
		return json({ error: 'Failed to process image' }, { status: 500 });
	}

	const avatarPath = `/avatars/${uuid}.webp`;
	db.update(personas)
		.set({ avatarPath })
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.run();

	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, avatarPath, personas: list });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) return json({ error: 'Invalid persona id' }, { status: 400 });

	db.update(personas)
		.set({ avatarPath: null })
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.run();

	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, personas: list });
};
