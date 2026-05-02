import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/db/index.js';
import { personas } from '$lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireOwned } from '$lib/server/ownership.js';
import { broadcast } from '$lib/server/realtime.js';

export const PUT: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, personas, event.params.id);
	const id = existing.id;
	const body = await event.request.json();

	// If setting as default, unset all others for this user first
	if (body.isDefault) {
		db.update(personas).set({ isDefault: false }).where(eq(personas.userId, user.id)).run();
	}

	// Validate avatarPath: must be a safe relative path under /avatars/
	const avatarPath = body.avatarPath && typeof body.avatarPath === 'string'
		&& /^\/avatars\/[\w.-]+$/.test(body.avatarPath)
		? body.avatarPath : null;

	db.update(personas)
		.set({
			name: body.name,
			displayName: body.displayName || '',
			description: body.description || '',
			avatarPath,
			isDefault: body.isDefault ?? false
		})
		.where(and(eq(personas.id, id), eq(personas.userId, user.id)))
		.run();

	// Return all personas — setting isDefault may have changed others' isDefault
	const list = db.select().from(personas).where(eq(personas.userId, user.id)).all();
	broadcast(user.id, { type: 'persona:replaced', personas: list as any });
	return json({ ok: true, personas: list });
};

export const DELETE: RequestHandler = async (event) => {
	const { user, row: existing } = requireOwned(event, personas, event.params.id);
	db.delete(personas).where(eq(personas.id, existing.id)).run();
	broadcast(user.id, { type: 'persona:deleted', id: existing.id });
	return json({ ok: true });
};
