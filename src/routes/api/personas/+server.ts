import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth.js';
import { broadcast } from '$lib/server/realtime.js';

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	return json({ personas: list });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = await event.request.json();

	// If setting as default, unset all others for this user first
	if (body.isDefault) {
		db.update(personas).set({ isDefault: false }).where(eq(personas.userId, user.id)).run();
	}

	// Validate avatarPath: must be a safe relative path under /avatars/
	const avatarPath = body.avatarPath && typeof body.avatarPath === 'string'
		&& /^\/avatars\/[\w.-]+$/.test(body.avatarPath)
		? body.avatarPath : null;

	const result = db
		.insert(personas)
		.values({
			userId: user.id,
			name: body.name,
			displayName: body.displayName || '',
			description: body.description || '',
			avatarPath,
			isDefault: body.isDefault ?? false
		})
		.returning()
		.get();

	// Return all personas — setting isDefault may have demoted others
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ...result, personas: list });
};
